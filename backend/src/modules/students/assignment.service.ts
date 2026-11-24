import { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { AcademicYearModel, EDITABLE_YEAR_STATUSES } from '../academics/academic-year.model.js';
import { SchoolClassModel } from '../academics/class.model.js';
import { SectionModel } from '../academics/section.model.js';
import { StudentAssignmentModel, type AssignmentOutcome, type AssignmentType, type StudentAssignment } from './assignment.model.js';
import { StudentModel, day, fullName, type StudentDocument } from './student.model.js';
import { assertNotArchived, audit, findStudent, oid } from './students.shared.js';

type AssignmentLike = StudentAssignment & { _id: Types.ObjectId };

export interface PlaceInput {
  academicYearId: string;
  classId: string;
  sectionId: string;
  startDate?: Date;
  assignmentType?: AssignmentType;
  notes?: string;
  /** Place even if the section is at its sanctioned strength. */
  allowOverCapacity?: boolean;
}

const utcToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const clampToYear = (d: Date, y: { startDate: Date; endDate: Date }) => (d < y.startDate ? y.startDate : d > y.endDate ? y.endDate : d);

/** Validates that year, class and section belong together in this school (FRD §7.3, §16.11). */
async function resolvePlacement(organizationId: string, input: { academicYearId: string; classId: string; sectionId: string }, session?: ClientSession) {
  const valid = [input.academicYearId, input.classId, input.sectionId].every((id) => Types.ObjectId.isValid(id));
  // Sequential on purpose: a transaction session can't run operations in parallel.
  const year = valid ? await AcademicYearModel.findOne({ _id: input.academicYearId, organizationId }).session(session ?? null).lean() : null;
  const cls = valid ? await SchoolClassModel.findOne({ _id: input.classId, organizationId }).session(session ?? null).lean() : null;
  const section = valid ? await SectionModel.findOne({ _id: input.sectionId, organizationId }).session(session ?? null).lean() : null;
  if (!year) throw ApiError.notFound('Academic year not found');
  if (!cls) throw ApiError.notFound('Class not found');
  if (!section) throw ApiError.notFound('Section not found');
  if (String(section.classId) !== String(cls._id)) throw ApiError.badRequest(`Section ${section.name} is not a section of ${cls.name}.`, { sectionId: ['Not in this class'] });
  if (String(section.academicYearId) !== String(year._id)) throw ApiError.badRequest(`Section ${section.name} belongs to a different academic year.`, { sectionId: ['Not in this academic year'] });
  return { year, cls, section };
}

function assertYearOpen(year: { name: string; status: string }) {
  if (!EDITABLE_YEAR_STATUSES.includes(year.status as never)) {
    throw ApiError.conflict(`${year.name} is ${year.status}. Use a correction to change placements in a closed year.`, { reason: 'year_locked', status: year.status });
  }
}

function assertPlaceable(student: StudentDocument) {
  assertNotArchived(student);
  if (student.registrationStatus !== 'completed') throw ApiError.conflict('Complete the registration before placing the student in a class.', { reason: 'registration_incomplete' });
  if (!['active', 'inactive'].includes(student.status)) throw ApiError.conflict(`This student is ${student.status}. Re-admit them before placing them in a class.`, { reason: 'student_not_enrolled', status: student.status });
}

async function assertCapacity(organizationId: string, section: { _id: Types.ObjectId; name: string; capacity: number }, session: ClientSession) {
  const placed = await StudentAssignmentModel.countDocuments({ organizationId, sectionId: section._id, status: 'active' }).session(session);
  if (placed >= section.capacity) {
    throw ApiError.conflict(`Section ${section.name} is full (${placed} of ${section.capacity}).`, { reason: 'section_full', placed, capacity: section.capacity });
  }
}

const snapshot = (a: AssignmentLike) => ({
  academicYearId: String(a.academicYearId),
  classId: String(a.classId),
  sectionId: String(a.sectionId),
  startDate: day(a.startDate),
  endDate: day(a.endDate),
  status: a.status,
  outcome: a.outcome ?? null,
});

/** Assignments with year, class and section names, newest year first. */
async function enrich(organizationId: string, rows: AssignmentLike[]) {
  const ids = (k: 'academicYearId' | 'classId' | 'sectionId') => [...new Set(rows.map((r) => String(r[k])))].map(oid);
  const [years, classes, sections] = await Promise.all([
    AcademicYearModel.find({ organizationId, _id: { $in: ids('academicYearId') } }, { name: 1, code: 1, status: 1, startDate: 1, endDate: 1 }).lean(),
    SchoolClassModel.find({ organizationId, _id: { $in: ids('classId') } }, { name: 1, code: 1, displayOrder: 1 }).lean(),
    SectionModel.find({ organizationId, _id: { $in: ids('sectionId') } }, { name: 1, code: 1, room: 1 }).lean(),
  ]);
  const by = <T extends { _id: unknown }>(list: T[]) => new Map(list.map((x) => [String(x._id), x]));
  const [y, c, s] = [by(years), by(classes), by(sections)];
  return rows
    .map((a) => {
      const year = y.get(String(a.academicYearId));
      const cls = c.get(String(a.classId));
      const sec = s.get(String(a.sectionId));
      return {
        id: String(a._id),
        studentId: String(a.studentId),
        academicYear: year ? { id: String(year._id), name: year.name, code: year.code, status: year.status } : null,
        class: cls ? { id: String(cls._id), name: cls.name, code: cls.code } : null,
        section: sec ? { id: String(sec._id), name: sec.name, code: sec.code, room: sec.room ?? null } : null,
        startDate: day(a.startDate),
        endDate: day(a.endDate),
        status: a.status,
        assignmentType: a.assignmentType,
        outcome: a.outcome ?? null,
        previousAssignmentId: a.previousAssignmentId ? String(a.previousAssignmentId) : null,
        notes: a.notes ?? null,
        corrections: (a.corrections ?? []).map((k) => ({ reason: k.reason, before: k.before, correctedBy: String(k.correctedBy), correctedAt: k.correctedAt })),
        createdAt: a.createdAt,
        _sort: [year?.startDate?.getTime() ?? 0, a.startDate.getTime()] as const,
      };
    })
    .sort((p, q) => q._sort[0] - p._sort[0] || q._sort[1] - p._sort[1])
    .map(({ _sort, ...rest }) => (void _sort, rest));
}

export type PublicAssignment = Awaited<ReturnType<typeof enrich>>[number];

export const assignmentService = {
  enrich,

  async history(organizationId: string, studentId: string) {
    await findStudent(organizationId, studentId, { includeArchived: true });
    const rows = (await StudentAssignmentModel.find({ organizationId, studentId }).lean()) as AssignmentLike[];
    return enrich(organizationId, rows);
  },

  /**
   * The student's current placement per student: the active placement in the given year, or
   * (no year) in the school's current year, falling back to their latest active placement.
   */
  async current(organizationId: string, studentIds: string[], academicYearId?: string): Promise<Map<string, PublicAssignment>> {
    if (studentIds.length === 0) return new Map();
    const filter: Record<string, unknown> = { organizationId, studentId: { $in: studentIds.map(oid) } };
    if (academicYearId) {
      filter.academicYearId = oid(academicYearId);
      filter.status = { $in: ['active', 'completed'] };
    } else filter.status = 'active';
    const rows = await enrich(organizationId, (await StudentAssignmentModel.find(filter).lean()) as AssignmentLike[]);
    const currentYear = academicYearId ? null : await AcademicYearModel.findOne({ organizationId, status: 'active' }, { _id: 1 }).lean();
    const currentYearId = currentYear ? String(currentYear._id) : null;
    // Prefer the school's current year, then active over completed; rows are newest-year first,
    // so among equals the latest wins.
    const rank = (r: PublicAssignment) => (currentYearId && r.academicYear?.id === currentYearId ? 2 : 0) + (r.status === 'active' ? 1 : 0);
    const out = new Map<string, PublicAssignment>();
    for (const r of rows) {
      const existing = out.get(r.studentId);
      if (!existing || rank(r) > rank(existing)) out.set(r.studentId, r);
    }
    return out;
  },

  /**
   * Places a student in a section for a year, inside the caller's transaction. Promotion and
   * retention placements close the student's open placement in other years with that outcome.
   */
  async placeInSession(ctx: OrgActor, session: ClientSession, student: StudentDocument, input: PlaceInput) {
    const { year, cls, section } = await resolvePlacement(ctx.organizationId, input, session);
    assertYearOpen(year);
    if (cls.status !== 'active' || section.status !== 'active') throw ApiError.badRequest(`${cls.name} ${section.name} is inactive.`, { reason: 'section_inactive' });
    const existing = await StudentAssignmentModel.findOne({ organizationId: ctx.organizationId, studentId: student._id, academicYearId: year._id, status: 'active' }).session(session).lean();
    if (existing) {
      throw ApiError.conflict(`${fullName(student)} is already placed in ${year.name}. Transfer them instead.`, { reason: 'already_assigned', assignmentId: String(existing._id) });
    }
    if (!input.allowOverCapacity) await assertCapacity(ctx.organizationId, section, session);
    const startDate = clampToYear(input.startDate ?? utcToday(), year);
    const type = input.assignmentType ?? 'placement';

    const outcome: AssignmentOutcome | null = type === 'promotion' ? 'promoted' : type === 'retention' ? 'retained' : null;
    if (outcome) {
      const open = await StudentAssignmentModel.find({ organizationId: ctx.organizationId, studentId: student._id, status: 'active', academicYearId: { $ne: year._id } }).session(session);
      for (const a of open) {
        a.status = 'completed';
        a.outcome = outcome;
        a.endDate ??= startDate;
        await a.save({ session });
        await audit(ctx, 'student_assignment.closed', String(a._id), { after: { status: 'completed', outcome }, metadata: { studentId: String(student._id) } }, session);
      }
    }

    try {
      const [created] = await StudentAssignmentModel.create(
        [{ organizationId: ctx.organizationId, studentId: student._id, academicYearId: year._id, classId: cls._id, sectionId: section._id, startDate, assignmentType: type, notes: input.notes, assignedBy: ctx.actorId }],
        { session },
      );
      await audit(ctx, 'student_assignment.created', String(created!._id), { after: snapshot(created!.toObject() as AssignmentLike), metadata: { studentId: String(student._id), assignmentType: type } }, session);
      return created!;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw ApiError.conflict('This student is already placed in that academic year.', { reason: 'already_assigned' });
      throw err;
    }
  },

  async place(ctx: OrgActor, studentId: string, input: PlaceInput) {
    const id = await inTransaction(async (session) => {
      const student = await findStudent(ctx.organizationId, studentId, { session });
      assertPlaceable(student);
      return String((await this.placeInSession(ctx, session, student, input))._id);
    });
    return this.getOne(ctx.organizationId, studentId, id);
  },

  async getOne(organizationId: string, studentId: string, assignmentId: string) {
    const a = Types.ObjectId.isValid(assignmentId) ? await StudentAssignmentModel.findOne({ _id: assignmentId, organizationId, studentId }).lean() : null;
    if (!a) throw ApiError.notFound('Class placement not found');
    return (await enrich(organizationId, [a as AssignmentLike]))[0]!;
  },

  /**
   * Moves a student to another section (and possibly class) within the same year (FRD §7.4):
   * the current placement is closed as superseded and a new one opened, preserving history.
   */
  async transfer(ctx: OrgActor, studentId: string, input: { sectionId: string; effectiveDate?: Date; reason?: string; allowOverCapacity?: boolean }) {
    const id = await inTransaction(async (session) => {
      const student = await findStudent(ctx.organizationId, studentId, { session });
      assertPlaceable(student);
      const target = Types.ObjectId.isValid(input.sectionId) ? await SectionModel.findOne({ _id: input.sectionId, organizationId: ctx.organizationId }).session(session).lean() : null;
      if (!target) throw ApiError.notFound('Section not found');
      const { year, cls, section } = await resolvePlacement(ctx.organizationId, { academicYearId: String(target.academicYearId), classId: String(target.classId), sectionId: input.sectionId }, session);
      assertYearOpen(year);
      if (cls.status !== 'active' || section.status !== 'active') throw ApiError.badRequest(`${cls.name} ${section.name} is inactive.`, { reason: 'section_inactive' });
      const current = await StudentAssignmentModel.findOne({ organizationId: ctx.organizationId, studentId: student._id, academicYearId: year._id, status: 'active' }).session(session);
      if (!current) throw ApiError.conflict(`${fullName(student)} isn't placed in ${year.name} yet. Assign a class instead.`, { reason: 'not_assigned' });
      if (String(current.sectionId) === input.sectionId) throw ApiError.badRequest('The student is already in this section.');
      if (!input.allowOverCapacity) await assertCapacity(ctx.organizationId, section, session);

      const effective = clampToYear(input.effectiveDate ?? utcToday(), year);
      if (effective < current.startDate) throw ApiError.badRequest('The transfer date is before the current placement started.', { effectiveDate: ['Too early'] });
      const before = snapshot(current.toObject() as AssignmentLike);
      current.status = 'superseded';
      current.endDate = effective;
      await current.save({ session });
      const [next] = await StudentAssignmentModel.create(
        [{ organizationId: ctx.organizationId, studentId: student._id, academicYearId: year._id, classId: cls._id, sectionId: section._id, startDate: effective, assignmentType: 'transfer', previousAssignmentId: current._id, notes: input.reason, assignedBy: ctx.actorId }],
        { session },
      );
      await audit(ctx, 'student_assignment.transferred', String(next!._id), { before, after: snapshot(next!.toObject() as AssignmentLike), metadata: { studentId, fromAssignmentId: String(current._id), reason: input.reason ?? null } }, session);
      return String(next!._id);
    });
    return this.getOne(ctx.organizationId, studentId, id);
  },

  /**
   * Corrects a placement in place (wrong section entered, wrong start date…), keeping the
   * previous values and the reason on the record and in the audit log. Allowed in closed years:
   * this is the authorized correction workflow of FRD §7.3.
   */
  async correct(ctx: OrgActor, studentId: string, assignmentId: string, input: { classId?: string; sectionId?: string; startDate?: Date; endDate?: Date | null; notes?: string | null; reason: string }) {
    await inTransaction(async (session) => {
      const student = await findStudent(ctx.organizationId, studentId, { session, includeArchived: true });
      const a = Types.ObjectId.isValid(assignmentId) ? await StudentAssignmentModel.findOne({ _id: assignmentId, organizationId: ctx.organizationId, studentId: student._id }).session(session) : null;
      if (!a) throw ApiError.notFound('Class placement not found');
      const before = snapshot(a.toObject() as AssignmentLike);
      if (input.classId || input.sectionId) {
        const sectionId = input.sectionId ?? String(a.sectionId);
        const classId = input.classId ?? String((await SectionModel.findOne({ _id: sectionId, organizationId: ctx.organizationId }, { classId: 1 }).session(session).lean())?.classId ?? a.classId);
        const { cls, section } = await resolvePlacement(ctx.organizationId, { academicYearId: String(a.academicYearId), classId, sectionId }, session);
        a.classId = cls._id;
        a.sectionId = section._id;
      }
      const year = (await AcademicYearModel.findById(a.academicYearId).session(session).lean())!;
      if (input.startDate) a.startDate = input.startDate;
      if (input.endDate !== undefined) a.endDate = input.endDate ?? undefined;
      if (a.startDate < year.startDate || a.startDate > year.endDate) throw ApiError.badRequest(`The start date must fall within ${year.name}.`, { startDate: ['Outside the academic year'] });
      if (a.endDate && a.endDate < a.startDate) throw ApiError.badRequest('The end date is before the start date.', { endDate: ['Before start date'] });
      if (input.notes !== undefined) a.notes = input.notes ?? undefined;
      const after = snapshot(a.toObject() as AssignmentLike);
      if (JSON.stringify(before) === JSON.stringify(after) && input.notes === undefined) throw ApiError.badRequest('Nothing to correct.');
      a.corrections.push({ reason: input.reason, before, correctedBy: oid(ctx.actorId), correctedAt: new Date() });
      await a.save({ session });
      await audit(ctx, 'student_assignment.corrected', assignmentId, { before, after, metadata: { studentId, reason: input.reason, yearStatus: year.status } }, session);
    });
    return this.getOne(ctx.organizationId, studentId, assignmentId);
  },

  /** Ends a placement with an outcome (promoted / retained), e.g. at year end. */
  async close(ctx: OrgActor, studentId: string, assignmentId: string, input: { outcome: 'promoted' | 'retained'; endDate?: Date }) {
    const a = Types.ObjectId.isValid(assignmentId) ? await StudentAssignmentModel.findOne({ _id: assignmentId, organizationId: ctx.organizationId, studentId }) : null;
    if (!a) throw ApiError.notFound('Class placement not found');
    if (a.status !== 'active') throw ApiError.conflict('Only the current placement can be closed.', { reason: 'not_active' });
    const year = (await AcademicYearModel.findById(a.academicYearId).lean())!;
    const before = snapshot(a.toObject() as AssignmentLike);
    a.status = 'completed';
    a.outcome = input.outcome;
    a.endDate = input.endDate ?? year.endDate;
    await a.save();
    await audit(ctx, 'student_assignment.closed', assignmentId, { before, after: snapshot(a.toObject() as AssignmentLike), metadata: { studentId } });
    return this.getOne(ctx.organizationId, studentId, assignmentId);
  },

  /** Closes open placements when a student leaves (transferred out, withdrawn, graduated). */
  async closeAllForLeaving(ctx: OrgActor, session: ClientSession, studentId: string, outcome: AssignmentOutcome, endDate: Date) {
    const open = await StudentAssignmentModel.find({ organizationId: ctx.organizationId, studentId, status: 'active' }).session(session);
    for (const a of open) {
      a.status = 'completed';
      a.outcome = outcome;
      a.endDate = a.startDate > endDate ? a.startDate : endDate;
      await a.save({ session });
      await audit(ctx, 'student_assignment.closed', String(a._id), { after: { status: 'completed', outcome }, metadata: { studentId } }, session);
    }
    return open.length;
  },

  /**
   * Year-end promotion: places students of one section into a section of another year. Students
   * already placed in the target year, or no longer enrolled, are skipped and reported.
   */
  async bulkPromote(ctx: OrgActor, input: { fromSectionId: string; toSectionId: string; studentIds?: string[]; assignmentType?: 'promotion' | 'retention'; allowOverCapacity?: boolean; scopeFilter: Record<string, unknown> | null }) {
    const [from, to] = await Promise.all(
      [input.fromSectionId, input.toSectionId].map((id) => (Types.ObjectId.isValid(id) ? SectionModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean() : null)),
    );
    if (!from || !to) throw ApiError.notFound('Section not found');
    if (String(from.academicYearId) === String(to.academicYearId)) throw ApiError.badRequest('Pick a section in a different academic year. Use a transfer to move students within a year.');
    const filter: Record<string, unknown> = { organizationId: ctx.organizationId, sectionId: from._id, status: { $in: ['active', 'completed'] } };
    if (input.studentIds) filter.studentId = { $in: input.studentIds.filter((id) => Types.ObjectId.isValid(id)).map(oid) };
    const candidates = await StudentAssignmentModel.distinct('studentId', filter);
    const students = await StudentModel.find({ organizationId: ctx.organizationId, _id: { $in: candidates }, deletedAt: null, ...(input.scopeFilter && { $and: [input.scopeFilter] }) });
    const placed: string[] = [];
    const skipped: { studentId: string; name: string; reason: string }[] = [];
    for (const s of students) {
      try {
        assertPlaceable(s);
        await inTransaction((session) => this.placeInSession(ctx, session, s, { academicYearId: String(to.academicYearId), classId: String(to.classId), sectionId: String(to._id), assignmentType: input.assignmentType ?? 'promotion', allowOverCapacity: input.allowOverCapacity }));
        placed.push(String(s._id));
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        skipped.push({ studentId: String(s._id), name: fullName(s), reason: (err.details as { reason?: string })?.reason ?? err.message });
      }
    }
    return { placed: placed.length, placedStudentIds: placed, skipped };
  },
};
