import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import {
  ACADEMIC_YEAR_TRANSITIONS,
  AcademicYearModel,
  toPublicAcademicYear,
  type AcademicYear,
  type AcademicYearStatus,
} from './academic-year.model.js';
import { academicUnits } from './academic-units.js';
import { assertYearEditable, audit, findYear, oid, toCode } from './academics.shared.js';
import { SchoolClassModel } from './class.model.js';
import { SectionModel } from './section.model.js';
import { sectionService } from './section.service.js';

export interface TermInput {
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface AcademicYearInput {
  name: string;
  code?: string;
  startDate: Date;
  endDate: Date;
  terms?: TermInput[];
}

const DAY = 86_400_000;
/** A school year is about twelve months; anything past two years is almost certainly a typo. */
const MAX_YEAR_DAYS = 731;
const day = (d: Date) => d.toISOString().slice(0, 10);

function assertDates(start: Date, end: Date) {
  if (end <= start) throw ApiError.badRequest('The end date must be after the start date.', { endDate: ['Must be after the start date'] });
  if ((end.getTime() - start.getTime()) / DAY > MAX_YEAR_DAYS) {
    throw ApiError.badRequest('An academic year can be at most two years long.', { endDate: ['At most two years after the start date'] });
  }
}

/** Terms must sit inside the year, not overlap, and have distinct names. Returned in date order. */
function normalizeTerms(terms: TermInput[], start: Date, end: Date): TermInput[] {
  const sorted = [...terms].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const names = new Set<string>();
  sorted.forEach((t, i) => {
    const key = t.name.trim().toLowerCase();
    if (names.has(key)) throw ApiError.badRequest(`Two terms are called "${t.name}".`, { terms: ['Term names must be unique'] });
    names.add(key);
    if (t.endDate < t.startDate) throw ApiError.badRequest(`${t.name} ends before it starts.`, { terms: [`${t.name}: end date is before start date`] });
    if (t.startDate < start || t.endDate > end) {
      throw ApiError.badRequest(`${t.name} must fall within the academic year (${day(start)} to ${day(end)}).`, { terms: [`${t.name} is outside the year`] });
    }
    const prev = sorted[i - 1];
    if (prev && t.startDate <= prev.endDate) {
      throw ApiError.badRequest(`${prev.name} and ${t.name} overlap.`, { terms: [`${prev.name} and ${t.name} overlap`] });
    }
  });
  return sorted;
}

/** Years can't overlap: "today" must map to at most one year. */
async function assertNoOverlap(organizationId: string, start: Date, end: Date, exceptId?: Types.ObjectId) {
  const clash = await AcademicYearModel.findOne(
    { organizationId, startDate: { $lte: end }, endDate: { $gte: start }, ...(exceptId && { _id: { $ne: exceptId } }) },
    { name: 1 },
  ).lean();
  if (clash) throw ApiError.conflict(`These dates overlap with ${clash.name}.`, { reason: 'years_overlap', academicYearId: String(clash._id) });
}

async function assertNameFree(organizationId: string, name: string, code: string, exceptId?: Types.ObjectId) {
  const except = exceptId ? { _id: { $ne: exceptId } } : {};
  if (await AcademicYearModel.exists({ organizationId, name, ...except }).collation({ locale: 'en', strength: 2 })) {
    throw ApiError.conflict(`An academic year called ${name} already exists.`, { name: ['Already used'] });
  }
  if (await AcademicYearModel.exists({ organizationId, code, ...except })) {
    throw ApiError.conflict(`The code ${code} is already used by another academic year.`, { code: ['Already used'] });
  }
}

function deriveCode(name: string, code?: string) {
  const out = code ?? toCode(name, 12);
  if (!out) throw ApiError.badRequest('Give the academic year a code (letters, digits, hyphens).', { code: ['Required'] });
  return out;
}

/** Section and class counts per year, for list views. */
async function structureCounts(organizationId: string, yearIds: Types.ObjectId[]) {
  const rows = await SectionModel.aggregate<{ _id: Types.ObjectId; sections: number; capacity: number; classes: Types.ObjectId[] }>([
    { $match: { organizationId: new Types.ObjectId(organizationId), academicYearId: { $in: yearIds }, status: 'active' } },
    { $group: { _id: '$academicYearId', sections: { $sum: 1 }, capacity: { $sum: '$capacity' }, classes: { $addToSet: '$classId' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { sectionCount: r.sections, classCount: r.classes.length, totalCapacity: r.capacity }]));
}

const EMPTY_COUNTS = { sectionCount: 0, classCount: 0, totalCapacity: 0 };

/** Keeps the free-text `settings.academicYear` (shown on dashboards) in step with the current year. */
async function syncOrganizationLabel(organizationId: string, session: Parameters<Parameters<typeof inTransaction>[0]>[0]) {
  const current = await AcademicYearModel.findOne({ organizationId, status: 'active' }, { name: 1 }).session(session).lean();
  await OrganizationModel.updateOne(
    { _id: organizationId },
    current ? { $set: { 'settings.academicYear': current.name } } : { $unset: { 'settings.academicYear': 1 } },
    { session },
  );
}

const snapshot = (y: AcademicYear) => ({ name: y.name, code: y.code, startDate: day(y.startDate), endDate: day(y.endDate), status: y.status, terms: y.terms.length });

export const academicYearService = {
  async list(organizationId: string, filter: { status?: AcademicYearStatus } = {}) {
    const years = await AcademicYearModel.find({ organizationId, ...(filter.status && { status: filter.status }) }).sort({ startDate: -1 }).lean();
    const counts = await structureCounts(organizationId, years.map((y) => y._id));
    return years.map((y) => toPublicAcademicYear(y, counts.get(String(y._id)) ?? EMPTY_COUNTS));
  },

  async get(organizationId: string, id: string) {
    const year = await findYear(organizationId, id);
    const counts = await structureCounts(organizationId, [year._id]);
    return toPublicAcademicYear(year.toObject(), counts.get(id) ?? EMPTY_COUNTS);
  },

  /** The current year, or null when the school hasn't activated one. */
  async current(organizationId: string) {
    const year = await AcademicYearModel.findOne({ organizationId, status: 'active' }).lean();
    return year ? this.get(organizationId, String(year._id)) : null;
  },

  async create(ctx: OrgActor, input: AcademicYearInput) {
    assertDates(input.startDate, input.endDate);
    const code = deriveCode(input.name, input.code);
    const terms = normalizeTerms(input.terms ?? [], input.startDate, input.endDate);
    await assertNameFree(ctx.organizationId, input.name, code);
    await assertNoOverlap(ctx.organizationId, input.startDate, input.endDate);
    const year = await AcademicYearModel.create({
      organizationId: ctx.organizationId,
      name: input.name,
      code,
      startDate: input.startDate,
      endDate: input.endDate,
      terms,
      status: 'planned',
      createdBy: ctx.actorId,
    });
    await audit(ctx, 'academic_year.created', String(year._id), { after: snapshot(year) });
    return toPublicAcademicYear(year.toObject(), EMPTY_COUNTS);
  },

  async update(ctx: OrgActor, id: string, input: Partial<AcademicYearInput>) {
    const year = await findYear(ctx.organizationId, id);
    assertYearEditable(year);
    const before = snapshot(year);
    const start = input.startDate ?? year.startDate;
    const end = input.endDate ?? year.endDate;
    if (input.startDate || input.endDate) {
      assertDates(start, end);
      await assertNoOverlap(ctx.organizationId, start, end, year._id);
    }
    // Existing terms are re-checked against changed dates too.
    const terms = normalizeTerms(input.terms ?? year.terms.map((t) => ({ name: t.name, startDate: t.startDate, endDate: t.endDate })), start, end);
    const name = input.name ?? year.name;
    // Renaming keeps the code (it's embedded in section unit codes) unless a new one is given.
    const code = input.code ?? year.code;
    if (name !== year.name || code !== year.code) await assertNameFree(ctx.organizationId, name, code, year._id);

    await inTransaction(async (session) => {
      year.name = name;
      year.code = code;
      year.startDate = start;
      year.endDate = end;
      year.set('terms', terms);
      await year.save({ session });
      if (before.name !== name || before.code !== code) {
        await academicUnits.resyncSections(session, ctx.organizationId, { academicYearId: year._id });
        if (year.status === 'active') await syncOrganizationLabel(ctx.organizationId, session);
      }
    });
    await audit(ctx, 'academic_year.updated', id, { before, after: snapshot(year) });
    return this.get(ctx.organizationId, id);
  },

  /**
   * Moves a year through its lifecycle. Activating a year while another is current needs
   * `closeCurrent: true`, which closes the current year in the same transaction.
   */
  async changeStatus(ctx: OrgActor, id: string, status: AcademicYearStatus, opts: { closeCurrent?: boolean } = {}) {
    const year = await findYear(ctx.organizationId, id);
    const from = year.status;
    if (from === status) return this.get(ctx.organizationId, id);
    if (!ACADEMIC_YEAR_TRANSITIONS[from].includes(status)) {
      throw ApiError.conflict(`An academic year can't go from ${from} to ${status}.`, { reason: 'invalid_transition', from, to: status });
    }

    let closed: { id: string; name: string } | null = null;
    if (status === 'active') {
      const current = await AcademicYearModel.findOne({ organizationId: ctx.organizationId, status: 'active' }).lean();
      if (current && !opts.closeCurrent) {
        throw ApiError.conflict(`${current.name} is the current academic year. Close it first, or activate with closeCurrent.`, {
          reason: 'another_year_active',
          academicYearId: String(current._id),
          name: current.name,
        });
      }
      if (current) closed = { id: String(current._id), name: current.name };
    }

    await inTransaction(async (session) => {
      const now = new Date();
      if (closed) {
        await AcademicYearModel.updateOne({ _id: closed.id }, { $set: { status: 'completed', completedAt: now } }, { session });
        await academicUnits.resyncSections(session, ctx.organizationId, { academicYearId: oid(closed.id) });
      }
      year.status = status;
      if (status === 'active') year.activatedAt = now;
      if (status === 'completed' && from === 'active') year.completedAt = now;
      await year.save({ session });
      await academicUnits.resyncSections(session, ctx.organizationId, { academicYearId: year._id });
      if (status === 'active' || from === 'active') await syncOrganizationLabel(ctx.organizationId, session);
    });

    if (closed) await audit(ctx, 'academic_year.status_changed', closed.id, { before: { status: 'active' }, after: { status: 'completed' }, metadata: { replacedBy: id } });
    await audit(ctx, 'academic_year.status_changed', id, { before: { status: from }, after: { status }, ...(closed && { metadata: { closed: closed.id } }) });
    return this.get(ctx.organizationId, id);
  },

  /**
   * Deletes a year that isn't current, with its sections. Refused while anyone is placed in one
   * of its sections or a role is scoped to one, so history with people attached isn't lost.
   */
  async remove(ctx: OrgActor, id: string) {
    const year = await findYear(ctx.organizationId, id);
    if (year.status === 'active') throw ApiError.conflict(`${year.name} is the current academic year and can't be deleted.`, { reason: 'year_active' });
    const sections = await SectionModel.find({ organizationId: ctx.organizationId, academicYearId: year._id }, { unitId: 1 }).lean();
    const unitIds = sections.map((s) => s.unitId);
    await academicUnits.assertDeletable(ctx.organizationId, unitIds, 'academic year');
    await inTransaction(async (session) => {
      await SectionModel.deleteMany({ organizationId: ctx.organizationId, academicYearId: year._id }, { session });
      await academicUnits.remove(session, ctx.organizationId, unitIds);
      await year.deleteOne({ session });
    });
    await audit(ctx, 'academic_year.deleted', id, { before: snapshot(year), metadata: { sectionsDeleted: sections.length } });
  },

  /**
   * Year rollover: recreates another year's sections (name, code, strength, room) in this one,
   * for classes that are still active. Sections that already exist here are left alone. Class
   * teachers aren't copied; they're usually reassigned each year.
   */
  async copyStructure(ctx: OrgActor, targetId: string, sourceId: string) {
    if (targetId === sourceId) throw ApiError.badRequest('Choose a different academic year to copy from.');
    const [target, source] = await Promise.all([findYear(ctx.organizationId, targetId), findYear(ctx.organizationId, sourceId)]);
    assertYearEditable(target);
    const activeClassIds = (await SchoolClassModel.find({ organizationId: ctx.organizationId, status: 'active' }, { _id: 1 }).lean()).map((c) => c._id);
    const sourceSections = await SectionModel.find({ organizationId: ctx.organizationId, academicYearId: source._id, classId: { $in: activeClassIds } })
      .sort({ classId: 1, displayOrder: 1 })
      .lean();
    const existing = await SectionModel.find({ organizationId: ctx.organizationId, academicYearId: target._id }, { classId: 1, code: 1, name: 1 }).lean();
    const taken = new Set(existing.flatMap((s) => [`${s.classId}:code:${s.code}`, `${s.classId}:name:${s.name.toLowerCase()}`]));
    const toCreate = sourceSections.filter((s) => !taken.has(`${s.classId}:code:${s.code}`) && !taken.has(`${s.classId}:name:${s.name.toLowerCase()}`));

    const created = await sectionService.createMany(
      ctx,
      target,
      toCreate.map((s) => ({ classId: String(s.classId), name: s.name, code: s.code, capacity: s.capacity, room: s.room ?? undefined, displayOrder: s.displayOrder, status: s.status })),
    );
    await audit(ctx, 'academic_year.structure_copied', targetId, {
      metadata: { sourceAcademicYearId: sourceId, created: created.length, skipped: sourceSections.length - toCreate.length },
    });
    return { created: created.length, skipped: sourceSections.length - toCreate.length, sections: created };
  },
};
