import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { MembershipModel } from '../memberships/membership.model.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { OrganizationUnitModel } from '../organization-units/organization-unit.model.js';
import { organizationUnitService } from '../organization-units/organization-unit.service.js';
import { UserModel } from '../users/user.model.js';
import { registerScopeResolver, scopeService } from '../authorization/scope.service.js';
import { EDITABLE_YEAR_STATUSES, type AcademicYear } from './academic-year.model.js';
import { academicUnits, sectionUnitCode, sectionUnitName } from './academic-units.js';
import { alphabeticName, assertYearEditable, audit, findSection, findYear, oid, resolveYear, toCode, yearSummary } from './academics.shared.js';
import { SchoolClassModel } from './class.model.js';
import { SectionModel, toPublicSection, type Section } from './section.model.js';

/**
 * Sections are "in" their hierarchy unit, so class scope over Grade 10 covers 10A, and section
 * scope covers just that section. The class teacher counts as assigned to it.
 */
registerScopeResolver('section', async (organizationId, sectionId) => {
  if (!Types.ObjectId.isValid(sectionId)) return null;
  const s = await SectionModel.findOne({ _id: sectionId, organizationId }, { unitId: 1, classTeacherUserId: 1 }).lean();
  return s
    ? { id: sectionId, organizationId, unitIds: [String(s.unitId)], ownerIds: [], assignedUserIds: s.classTeacherUserId ? [String(s.classTeacherUserId)] : [] }
    : null;
});

export interface SectionSpec {
  classId: string;
  name: string;
  code?: string;
  capacity?: number;
  room?: string;
  displayOrder?: number;
  status?: 'active' | 'inactive';
}

type YearLike = AcademicYear & { _id: Types.ObjectId };
type SectionDoc = Section & { _id: Types.ObjectId };

/** Memberships (people placed) per unit, excluding revoked ones. */
async function memberCounts(organizationId: string, unitIds: Types.ObjectId[]) {
  if (unitIds.length === 0) return new Map<string, number>();
  const rows = await MembershipModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { organizationId: new Types.ObjectId(organizationId), organizationUnitIds: { $in: unitIds }, status: { $ne: 'revoked' } } },
    { $unwind: '$organizationUnitIds' },
    { $match: { organizationUnitIds: { $in: unitIds } } },
    { $group: { _id: '$organizationUnitIds', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Adds class, teacher and placement details to sections, sorted by class order then section order. */
async function enrich(organizationId: string, sections: SectionDoc[]) {
  const [classes, teachers, counts] = await Promise.all([
    SchoolClassModel.find({ organizationId, _id: { $in: [...new Set(sections.map((s) => String(s.classId)))].map(oid) } }, { name: 1, code: 1, displayOrder: 1, status: 1 }).lean(),
    UserModel.find({ _id: { $in: sections.flatMap((s) => (s.classTeacherUserId ? [s.classTeacherUserId] : [])) } }, { firstName: 1, lastName: 1, email: 1 }).lean(),
    memberCounts(organizationId, sections.map((s) => s.unitId)),
  ]);
  const classById = new Map(classes.map((c) => [String(c._id), c]));
  const teacherById = new Map(teachers.map((t) => [String(t._id), t]));
  return sections
    .map((s) => {
      const c = classById.get(String(s.classId));
      const t = s.classTeacherUserId ? teacherById.get(String(s.classTeacherUserId)) : undefined;
      return {
        order: [c?.displayOrder ?? 0, c?.name ?? '', s.displayOrder, s.name] as const,
        value: toPublicSection(s, {
          class: c ? { id: String(c._id), name: c.name, code: c.code, status: c.status } : null,
          classTeacher: t ? { id: String(t._id), name: `${t.firstName} ${t.lastName}`.trim(), email: t.email } : null,
          memberCount: counts.get(String(s.unitId)) ?? 0,
        }),
      };
    })
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1].localeCompare(b.order[1]) || a.order[2] - b.order[2] || a.order[3].localeCompare(b.order[3]))
    .map((r) => r.value);
}

const snapshot = (s: Section) => ({ name: s.name, code: s.code, capacity: s.capacity, room: s.room ?? null, status: s.status });

export const sectionService = {
  async list(organizationId: string, filter: { academicYearId?: string; classId?: string; status?: 'active' | 'inactive' }) {
    const year = await resolveYear(organizationId, filter.academicYearId);
    if (!year) return [];
    const q: Record<string, unknown> = { organizationId, academicYearId: year._id };
    if (filter.classId) q.classId = filter.classId;
    if (filter.status) q.status = filter.status;
    return enrich(organizationId, (await SectionModel.find(q).lean()) as SectionDoc[]);
  },

  async get(organizationId: string, id: string) {
    const section = await findSection(organizationId, id);
    const [enriched] = await enrich(organizationId, [section.toObject() as SectionDoc]);
    const year = await findYear(organizationId, String(section.academicYearId));
    return { ...enriched!, academicYear: yearSummary(year) };
  },

  /**
   * Creates sections in one transaction, each with its hierarchy unit. All or nothing: a clash
   * on any name or code rejects the whole batch.
   */
  async createMany(ctx: OrgActor, year: YearLike | (YearLike & { toObject(): unknown }), specs: SectionSpec[]) {
    assertYearEditable(year);
    if (specs.length === 0) return [];
    const classIds = [...new Set(specs.map((s) => s.classId))];
    const classes = await SchoolClassModel.find({ organizationId: ctx.organizationId, _id: { $in: classIds.filter((id) => Types.ObjectId.isValid(id)).map(oid) } }).lean();
    const classById = new Map(classes.map((c) => [String(c._id), c]));
    for (const id of classIds) {
      const c = classById.get(id);
      if (!c) throw ApiError.notFound('Class not found');
      if (c.status !== 'active') throw ApiError.badRequest(`${c.name} is inactive. Activate it before adding sections.`, { reason: 'class_inactive', classId: id });
    }

    const existing = await SectionModel.find({ organizationId: ctx.organizationId, academicYearId: year._id, classId: { $in: classes.map((c) => c._id) } }, { classId: 1, code: 1, name: 1, displayOrder: 1 }).lean();
    const taken = new Set(existing.flatMap((s) => [`${s.classId}:code:${s.code}`, `${s.classId}:name:${s.name.toLowerCase()}`]));
    const nextOrder = new Map<string, number>();
    for (const s of existing) nextOrder.set(String(s.classId), Math.max(nextOrder.get(String(s.classId)) ?? 0, s.displayOrder));

    const rows = specs.map((spec) => {
      const c = classById.get(spec.classId)!;
      const code = spec.code ?? toCode(spec.name, 10);
      if (!code) throw ApiError.badRequest(`Give section "${spec.name}" a code (letters, digits, hyphens).`, { code: ['Required'] });
      for (const [kind, key] of [['code', code], ['name', spec.name.toLowerCase()]] as const) {
        if (taken.has(`${spec.classId}:${kind}:${key}`)) {
          throw ApiError.conflict(`${c.name} already has a section ${kind === 'code' ? `with code ${code}` : `called ${spec.name}`} in ${year.name}.`, {
            reason: 'section_exists',
            classId: spec.classId,
            [kind]: ['Already used'],
          });
        }
        taken.add(`${spec.classId}:${kind}:${key}`);
      }
      const displayOrder = spec.displayOrder ?? (nextOrder.get(spec.classId) ?? 0) + 1;
      nextOrder.set(spec.classId, Math.max(nextOrder.get(spec.classId) ?? 0, displayOrder));
      return { spec, c, code, displayOrder, capacity: spec.capacity ?? c.defaultSectionCapacity, status: spec.status ?? 'active' };
    });

    const created = await inTransaction(async (session) => {
      const out: SectionDoc[] = [];
      for (const r of rows) {
        const unit = await academicUnits.createForSection(session, {
          organizationId: ctx.organizationId,
          classUnitId: r.c.unitId,
          name: sectionUnitName(r.c.name, r.spec.name, year.name),
          code: sectionUnitCode(r.c.code, r.code, year.code),
          active: r.status === 'active' && EDITABLE_YEAR_STATUSES.includes(year.status),
          actorId: ctx.actorId,
        });
        const [section] = await SectionModel.create(
          [
            {
              organizationId: ctx.organizationId,
              academicYearId: year._id,
              classId: r.c._id,
              name: r.spec.name,
              code: r.code,
              capacity: r.capacity,
              room: r.spec.room,
              displayOrder: r.displayOrder,
              status: r.status,
              unitId: unit._id,
              createdBy: ctx.actorId,
            },
          ],
          { session },
        );
        out.push(section!.toObject() as SectionDoc);
      }
      return out;
    });
    for (const s of created) await audit(ctx, 'section.created', String(s._id), { after: { ...snapshot(s), classId: String(s.classId), academicYearId: String(year._id) } });
    return enrich(ctx.organizationId, created);
  },

  async create(ctx: OrgActor, input: SectionSpec & { academicYearId: string }) {
    const year = await findYear(ctx.organizationId, input.academicYearId);
    const { academicYearId: _ignored, ...spec } = input;
    void _ignored;
    const [section] = await this.createMany(ctx, year, [spec]);
    return section!;
  },

  /**
   * Bulk setup: "Grade 1 has 4 sections of 35". `sectionCount` is the total wanted for the class
   * in this year; missing sections are added after the existing ones (A, B, C… or 1, 2, 3…), and
   * existing sections are never removed. Classes that already have enough are reported as skipped.
   */
  async bulkCreate(
    ctx: OrgActor,
    input: { academicYearId: string; naming: 'alphabetic' | 'numeric'; items: { classId: string; sectionCount: number; capacity?: number }[] },
  ) {
    const year = await findYear(ctx.organizationId, input.academicYearId);
    assertYearEditable(year);
    if (new Set(input.items.map((i) => i.classId)).size !== input.items.length) throw ApiError.badRequest('Each class can appear only once.');
    const existing = await SectionModel.find({ organizationId: ctx.organizationId, academicYearId: year._id, classId: { $in: input.items.map((i) => i.classId).filter((id) => Types.ObjectId.isValid(id)).map(oid) } }, { classId: 1, name: 1, code: 1 }).lean();
    const specs: SectionSpec[] = [];
    const skipped: { classId: string; existing: number }[] = [];
    for (const item of input.items) {
      const mine = existing.filter((s) => String(s.classId) === item.classId);
      const missing = item.sectionCount - mine.length;
      if (missing <= 0) {
        skipped.push({ classId: item.classId, existing: mine.length });
        continue;
      }
      const used = new Set(mine.flatMap((s) => [s.name.toLowerCase(), s.code.toLowerCase()]));
      for (let i = 0, added = 0; added < missing; i++) {
        const name = input.naming === 'numeric' ? String(i + 1) : alphabeticName(i);
        if (used.has(name.toLowerCase())) continue;
        specs.push({ classId: item.classId, name, capacity: item.capacity });
        added++;
      }
    }
    const created = await this.createMany(ctx, year, specs);
    return { created, skipped };
  },

  async update(ctx: OrgActor, id: string, input: { name?: string; code?: string; capacity?: number; room?: string | null; status?: 'active' | 'inactive'; displayOrder?: number }) {
    await scopeService.assertResource(ctx.grants, 'sections.update', id, 'Section not found');
    const section = await findSection(ctx.organizationId, id);
    const year = await findYear(ctx.organizationId, String(section.academicYearId));
    assertYearEditable(year);
    const cls = await SchoolClassModel.findOne({ _id: section.classId, organizationId: ctx.organizationId }).lean();
    if (input.status === 'active' && cls?.status !== 'active') throw ApiError.badRequest(`${cls?.name ?? 'The class'} is inactive. Activate the class first.`, { reason: 'class_inactive' });

    const before = snapshot(section);
    const name = input.name ?? section.name;
    const code = input.code ?? section.code;
    const siblings = { organizationId: ctx.organizationId, academicYearId: section.academicYearId, classId: section.classId, _id: { $ne: section._id } };
    if (code !== section.code && (await SectionModel.exists({ ...siblings, code }))) throw ApiError.conflict(`This class already has a section with code ${code}.`, { code: ['Already used'] });
    if (name !== section.name && (await SectionModel.exists({ ...siblings, name }).collation({ locale: 'en', strength: 2 }))) {
      throw ApiError.conflict(`This class already has a section called ${name}.`, { name: ['Already used'] });
    }

    section.name = name;
    section.code = code;
    if (input.capacity !== undefined) section.capacity = input.capacity;
    if (input.room !== undefined) section.room = input.room ?? undefined;
    if (input.status !== undefined) section.status = input.status;
    if (input.displayOrder !== undefined) section.displayOrder = input.displayOrder;
    await inTransaction(async (session) => {
      await section.save({ session });
      await academicUnits.resyncSections(session, ctx.organizationId, { sectionIds: [section._id] });
    });
    await audit(ctx, before.status !== section.status ? 'section.status_changed' : 'section.updated', id, { before, after: snapshot(section) });
    return this.get(ctx.organizationId, id);
  },

  /**
   * Sets (or clears, with null) the class teacher. The teacher is placed in the section's unit as
   * its head through the hierarchy service, so all of its rules apply: the person must be a
   * member, the actor can't place themselves, and placing them can't hand out access the actor
   * doesn't have. A replaced teacher stays placed in the section but is no longer its head.
   */
  async setClassTeacher(ctx: OrgActor, id: string, userId: string | null) {
    await scopeService.assertResource(ctx.grants, 'sections.update', id, 'Section not found');
    const section = await findSection(ctx.organizationId, id);
    const year = await findYear(ctx.organizationId, String(section.academicYearId));
    assertYearEditable(year);
    const previous = section.classTeacherUserId ? String(section.classTeacherUserId) : null;
    if (previous === userId) return this.get(ctx.organizationId, id);

    if (userId) {
      if (section.status !== 'active') throw ApiError.badRequest('Activate this section before assigning a class teacher.');
      const membership = await MembershipModel.findOne({ organizationId: ctx.organizationId, userId }, { status: 1 }).lean();
      if (!membership || membership.status === 'revoked') throw ApiError.notFound('Member not found');
      if (!['active', 'invited'].includes(membership.status)) {
        throw ApiError.badRequest(`This person's membership is ${membership.status}. Only active or invited members can be class teachers.`, { reason: 'membership_not_usable' });
      }
      await organizationUnitService.addMember(ctx, String(section.unitId), { userId, head: true });
    }
    if (previous) await OrganizationUnitModel.updateOne({ _id: section.unitId, organizationId: ctx.organizationId }, { $pull: { headUserIds: oid(previous) } });

    section.classTeacherUserId = userId ? oid(userId) : undefined;
    await section.save();
    await audit(ctx, 'section.class_teacher_changed', id, { before: { classTeacherUserId: previous }, after: { classTeacherUserId: userId } });
    return this.get(ctx.organizationId, id);
  },

  /** Deletes a section nobody is placed in (the class teacher counts) and no role is scoped to. */
  async remove(ctx: OrgActor, id: string) {
    const section = await findSection(ctx.organizationId, id);
    const year = await findYear(ctx.organizationId, String(section.academicYearId));
    assertYearEditable(year);
    await academicUnits.assertDeletable(ctx.organizationId, [section.unitId], 'section');
    await inTransaction(async (session) => {
      await section.deleteOne({ session });
      await academicUnits.remove(session, ctx.organizationId, [section.unitId]);
    });
    await audit(ctx, 'section.deleted', id, { before: { ...snapshot(section), classId: String(section.classId), academicYearId: String(section.academicYearId) } });
  },
};
