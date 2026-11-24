import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { escapeRegex, paginated, type Pagination } from '../../common/utils/pagination.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import type { Grants } from '../authorization/authorization.service.js';
import { hasPermission } from '../authorization/authorization.service.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { AcademicYearModel } from '../academics/academic-year.model.js';
import { resolveYear } from '../academics/academics.shared.js';
import { SectionModel } from '../academics/section.model.js';
import { sectionService } from '../academics/section.service.js';
import { scopeService } from '../authorization/scope.service.js';
import { StudentAssignmentModel, StudentIdCardModel } from './assignment.model.js';
import { assignmentService, type PlaceInput } from './assignment.service.js';
import { admissionService, studentSettingsService } from './admission.service.js';
import { GuardianModel, GuardianOtpModel, isVerifiedParentalContact, type GuardianLike } from './guardian.model.js';
import { guardianService } from './guardian.service.js';
import { photoView } from './photo.service.js';
import {
  LEAVING_STATUSES,
  STUDENT_STATUS_TRANSITIONS,
  StudentModel,
  ageOn,
  day,
  fullName,
  searchNameOf,
  type StudentDocument,
  type StudentLike,
  type StudentStatus,
} from './student.model.js';
import { assertNotArchived, audit, canOnStudent, findStudent, normalizePhone, oid, studentScopeFilter } from './students.shared.js';

type Address = { line1?: string | null; line2?: string | null; city?: string | null; district?: string | null; state?: string | null; country?: string | null; postalCode?: string | null };

export interface StudentInput {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  dateOfBirth?: Date;
  gender?: string;
  bloodGroup?: string | null;
  nationality?: string | null;
  motherTongue?: string | null;
  religion?: string | null;
  casteCategory?: string | null;
  caste?: string | null;
  medicalNotes?: string | null;
  residentialAddress?: Address;
  permanentAddress?: Address | null;
  permanentSameAsResidential?: boolean;
  previousSchool?: string | null;
  previousClass?: string | null;
}

export const SENSITIVE_FIELDS = ['religion', 'casteCategory', 'caste', 'medicalNotes'] as const;
const PLAIN_FIELDS = ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender', 'bloodGroup', 'nationality', 'motherTongue', 'previousSchool', 'previousClass', ...SENSITIVE_FIELDS] as const;
const REQUIRED_ADDRESS_FIELDS = ['line1', 'city', 'state', 'country', 'postalCode'] as const;

export interface ListQuery extends Pagination {
  search?: string;
  academicYearId?: string;
  classId?: string;
  sectionId?: string;
  gender?: string;
  status?: StudentStatus;
  verification?: 'verified' | 'unverified';
  archived?: boolean;
  sort: 'name' | 'admissionNumber' | 'recent';
}

/** What a viewer may see of a record, resolved once per request (FRD §16.6, §16.10). */
interface Visibility {
  sensitive: boolean;
  guardians: boolean;
}

const addressComplete = (a?: Address | null) => Boolean(a && REQUIRED_ADDRESS_FIELDS.every((f) => a[f]?.trim()));

/** Everything still missing before registration can be completed (FRD §3.1, §4.2). */
export function registrationChecklist(s: StudentLike, guardians: GuardianLike[]) {
  const missing: { field: string; message: string }[] = [];
  if (!s.lastName) missing.push({ field: 'lastName', message: 'Last name is required.' });
  if (!s.dateOfBirth) missing.push({ field: 'dateOfBirth', message: 'Date of birth is required.' });
  if (!s.gender) missing.push({ field: 'gender', message: 'Gender is required.' });
  if (!addressComplete(s.addresses?.residential)) missing.push({ field: 'residentialAddress', message: 'Residential address needs line 1, city, state, country and PIN code.' });
  if (s.addresses?.permanentSameAsResidential === false && !addressComplete(s.addresses?.permanent)) {
    missing.push({ field: 'permanentAddress', message: 'Permanent address needs line 1, city, state, country and PIN code.' });
  }
  if (guardians.length === 0) missing.push({ field: 'guardians', message: 'Add at least one parent or guardian.' });
  else {
    if (!guardians.some((g) => isVerifiedParentalContact(g))) missing.push({ field: 'guardians', message: "Verify at least one father's, mother's or guardian's mobile number by OTP." });
    if (!guardians.some((g) => g.isPrimaryContact)) missing.push({ field: 'guardians', message: 'Choose a primary contact.' });
  }
  return { complete: missing.length === 0, missing };
}

function toView(
  s: StudentLike,
  extra: {
    visibility: Visibility;
    assignment?: unknown;
    contact?: { primaryContact: unknown; hasVerifiedContact: boolean; contactCount: number };
  },
) {
  const residential = s.addresses?.residential ?? null;
  const same = s.addresses?.permanentSameAsResidential ?? true;
  return {
    id: String(s._id),
    organizationId: String(s.organizationId),
    admissionNumber: s.admissionNumber ?? null,
    admittedAt: s.admittedAt ?? null,
    firstName: s.firstName,
    middleName: s.middleName ?? null,
    lastName: s.lastName ?? null,
    fullName: fullName(s),
    dateOfBirth: day(s.dateOfBirth),
    age: s.dateOfBirth ? ageOn(s.dateOfBirth) : null,
    gender: s.gender ?? null,
    bloodGroup: s.bloodGroup ?? null,
    nationality: s.nationality ?? null,
    motherTongue: s.motherTongue ?? null,
    addresses: { residential, permanent: same ? residential : (s.addresses?.permanent ?? null), permanentSameAsResidential: same },
    previousSchool: s.previousSchool ?? null,
    previousClass: s.previousClass ?? null,
    photo: photoView(s.photo),
    status: s.status,
    registrationStatus: s.registrationStatus,
    statusReason: s.statusReason ?? null,
    statusChangedAt: s.statusChangedAt ?? null,
    archived: Boolean(s.deletedAt),
    archivedAt: s.deletedAt ?? null,
    currentAssignment: extra.assignment ?? null,
    ...(extra.contact && {
      primaryContact: extra.visibility.guardians ? extra.contact.primaryContact : null,
      hasVerifiedContact: extra.contact.hasVerifiedContact,
    }),
    /** Present only for viewers with students.read_sensitive over this student. */
    ...(extra.visibility.sensitive && {
      sensitive: { religion: s.religion ?? null, casteCategory: s.casteCategory ?? null, caste: s.caste ?? null, medicalNotes: s.medicalNotes ?? null },
    }),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function validateInput(organizationId: string, input: StudentInput) {
  if (input.dateOfBirth) {
    const age = ageOn(input.dateOfBirth);
    if (input.dateOfBirth > new Date()) throw ApiError.badRequest('Date of birth cannot be in the future.', { dateOfBirth: ['In the future'] });
    if (age > 30) throw ApiError.badRequest('Check the date of birth: the student would be over 30.', { dateOfBirth: ['Implausible'] });
  }
  if (input.gender === 'undisclosed' || input.casteCategory) {
    const settings = await studentSettingsService.load(organizationId);
    if (input.gender === 'undisclosed' && !settings.allowUndisclosedGender) throw ApiError.badRequest('This school requires a gender to be recorded.', { gender: ['Not allowed'] });
    if (input.casteCategory && !settings.casteCategories.some((c) => c.toLowerCase() === input.casteCategory!.toLowerCase())) {
      throw ApiError.badRequest(`Caste category must be one of: ${settings.casteCategories.join(', ')}.`, { casteCategory: ['Not a configured category'] });
    }
  }
}

function apply(student: StudentDocument, input: StudentInput) {
  for (const f of PLAIN_FIELDS) {
    if (input[f] !== undefined) student.set(f, input[f] ?? undefined);
  }
  if (input.residentialAddress !== undefined) student.set('addresses.residential', input.residentialAddress);
  if (input.permanentSameAsResidential !== undefined) student.set('addresses.permanentSameAsResidential', input.permanentSameAsResidential);
  if (input.permanentAddress !== undefined) student.set('addresses.permanent', input.permanentAddress ?? undefined);
  if (student.addresses?.permanentSameAsResidential) student.set('addresses.permanent', undefined);
  student.searchName = searchNameOf(student);
}

/** Names of fields an input changes. Values are personal data and are not recorded. */
function changedFields(before: StudentLike, after: StudentDocument) {
  const fields: string[] = PLAIN_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after.get(f) ?? null));
  if (JSON.stringify(before.addresses ?? null) !== JSON.stringify(after.toObject().addresses ?? null)) fields.push('addresses');
  return fields;
}

export const studentService = {
  async visibility(grants: Grants, studentId: string): Promise<Visibility> {
    const [sensitive, guardians] = await Promise.all([canOnStudent(grants, 'students.read_sensitive', studentId), canOnStudent(grants, 'guardians.read', studentId)]);
    return { sensitive, guardians };
  },

  async create(ctx: OrgActor, input: StudentInput & { firstName: string }) {
    await validateInput(ctx.organizationId, input);
    const student = new StudentModel({ organizationId: ctx.organizationId, firstName: input.firstName, searchName: '', status: 'draft', registrationStatus: 'draft', createdBy: ctx.actorId, addresses: { permanentSameAsResidential: true } });
    apply(student, input);
    await student.save();
    await audit(ctx, 'student.created', String(student._id), { metadata: { registrationStatus: 'draft', fields: Object.keys(input).filter((k) => !SENSITIVE_FIELDS.includes(k as never)) } });
    return this.get(ctx.grants, String(student._id), { audit: false });
  },

  async list(grants: Grants, organizationId: string, q: ListQuery) {
    const and: Record<string, unknown>[] = [];
    const scope = await studentScopeFilter(grants, 'students.read');
    if (scope) and.push(scope);

    const filter: Record<string, unknown> = { organizationId: oid(organizationId) };
    if (q.archived) {
      if (!hasPermission(grants, 'students.delete')) throw ApiError.forbidden('You cannot view archived students.');
      filter.deletedAt = { $ne: null };
    } else filter.deletedAt = null;
    if (q.gender) filter.gender = q.gender;

    // Year / class / section narrow to students placed there that year.
    const year = q.academicYearId || q.classId || q.sectionId ? await resolveYear(organizationId, q.academicYearId) : null;
    if (q.academicYearId || q.classId || q.sectionId) {
      if (!year) return paginated([], 0, q);
      const af: Record<string, unknown> = { organizationId: oid(organizationId), academicYearId: year._id, status: { $in: ['active', 'completed'] } };
      if (q.classId) af.classId = oid(q.classId);
      if (q.sectionId) af.sectionId = oid(q.sectionId);
      and.push({ _id: { $in: await StudentAssignmentModel.distinct('studentId', af) } });
    }
    // Class lists show enrolled students unless a status is asked for (FRD §11).
    if (q.status) filter.status = q.status;
    else if (q.classId || q.sectionId) filter.status = 'active';

    if (q.verification) {
      const verified = await guardianService.verifiedStudentIds(organizationId);
      and.push({ _id: q.verification === 'verified' ? { $in: verified } : { $nin: verified } });
    }

    if (q.search?.trim()) {
      const term = q.search.trim();
      const or: Record<string, unknown>[] = [
        { searchName: { $regex: escapeRegex(term.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')) } },
        { admissionNumber: { $regex: `^${escapeRegex(term)}`, $options: 'i' } },
      ];
      // Parent mobile number or email (FRD §9.2).
      const phone = /\d{6,}/.test(term.replace(/\D/g, '')) ? normalizePhone(term) : null;
      const guardianOr: Record<string, unknown>[] = [];
      if (phone) guardianOr.push({ mobileNumber: phone }, { alternateMobileNumber: phone });
      else if (/\d{4,}/.test(term)) guardianOr.push({ mobileNumber: { $regex: `${escapeRegex(term.replace(/\D/g, ''))}$` } });
      if (term.includes('@')) guardianOr.push({ email: term.toLowerCase() });
      if (guardianOr.length) {
        const ids = await GuardianModel.distinct('studentId', { organizationId: oid(organizationId), $or: guardianOr });
        or.push({ _id: { $in: ids } });
      }
      and.push({ $or: or });
    }
    if (and.length) filter.$and = and;

    const sort: Record<string, 1 | -1> = q.sort === 'admissionNumber' ? { admissionNumber: 1, searchName: 1 } : q.sort === 'recent' ? { createdAt: -1 } : { searchName: 1, _id: 1 };
    const [rows, total] = await Promise.all([
      StudentModel.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      StudentModel.countDocuments(filter),
    ]);
    const ids = rows.map((r) => String(r._id));
    const [assignments, contacts] = await Promise.all([assignmentService.current(organizationId, ids, year ? String(year._id) : undefined), guardianService.summaries(organizationId, ids)]);
    // Lists never carry sensitive fields; contact details only with guardians.read (whose scope
    // is checked per student only when it isn't organization-wide).
    const guardianScope = await studentScopeFilter(grants, 'guardians.read');
    const guardianIds = guardianScope ? new Set(((guardianScope._id as { $in: Types.ObjectId[] }).$in ?? []).map(String)) : null;
    const items = (rows as StudentLike[]).map((s) =>
      toView(s, {
        visibility: { sensitive: false, guardians: guardianIds ? guardianIds.has(String(s._id)) : true },
        assignment: assignments.get(String(s._id)) ?? null,
        contact: contacts.get(String(s._id)),
      }),
    );
    return paginated(items, total, q);
  },

  /**
   * One student, with the fields the viewer may see. Sensitive fields are included only with
   * students.read_sensitive over this student, and each such view is audited (FRD §3.2).
   */
  async get(grants: Grants, studentId: string, opts: { audit?: boolean; ctx?: OrgActor } = {}) {
    const organizationId = grants.organizationId!;
    const s = await findStudent(organizationId, studentId, { includeArchived: hasPermission(grants, 'students.delete') });
    const visibility = await this.visibility(grants, studentId);
    const [assignments, contacts, guardians] = await Promise.all([
      assignmentService.current(organizationId, [studentId]),
      guardianService.summaries(organizationId, [studentId]),
      GuardianModel.find({ organizationId, studentId }).lean(),
    ]);
    if (visibility.sensitive && opts.audit !== false && opts.ctx && SENSITIVE_FIELDS.some((f) => s.get(f))) {
      await audit(opts.ctx, 'student.sensitive_viewed', studentId, { metadata: { fields: SENSITIVE_FIELDS.filter((f) => s.get(f)) } });
    }
    const view = toView(s.toObject() as StudentLike, { visibility, assignment: assignments.get(studentId) ?? null, contact: contacts.get(studentId) });
    return {
      ...view,
      registration: s.registrationStatus === 'draft' ? registrationChecklist(s.toObject() as StudentLike, guardians as GuardianLike[]) : { complete: true, missing: [] },
      permissions: { sensitive: visibility.sensitive, guardians: visibility.guardians },
    };
  },

  /** Profile page payload: the student plus contacts, placement history and ID card history (FRD §10). */
  async profile(grants: Grants, studentId: string, ctx: OrgActor) {
    const student = await this.get(grants, studentId, { ctx });
    const organizationId = grants.organizationId!;
    const [guardians, assignments, admission, idCards] = await Promise.all([
      student.permissions.guardians ? guardianService.list(organizationId, studentId) : Promise.resolve(null),
      assignmentService.history(organizationId, studentId),
      admissionService.get(organizationId, studentId),
      StudentIdCardModel.find({ organizationId, studentId }).sort({ generatedAt: -1 }).limit(10).lean(),
    ]);
    return {
      student,
      guardians,
      assignments,
      admission,
      idCards: idCards.map((c) => ({ id: String(c._id), version: c.version, generatedAt: c.generatedAt, generatedBy: String(c.generatedBy), templateId: c.templateId ? String(c.templateId) : null, academicAssignmentId: String(c.academicAssignmentId) })),
    };
  },

  async update(ctx: OrgActor, studentId: string, input: StudentInput) {
    const s = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(s);
    await validateInput(ctx.organizationId, input);
    const before = s.toObject() as StudentLike;
    apply(s, input);
    // A registered student must stay complete: mandatory fields can't be emptied.
    if (s.registrationStatus === 'completed') {
      const problems = registrationChecklist(s.toObject() as StudentLike, (await GuardianModel.find({ organizationId: ctx.organizationId, studentId }).lean()) as GuardianLike[]).missing.filter((m) => m.field !== 'guardians');
      if (problems.length) throw ApiError.badRequest(problems[0]!.message, Object.fromEntries(problems.map((p) => [p.field, [p.message]])));
    }
    const fields = changedFields(before, s);
    if (fields.length === 0) return this.get(ctx.grants, studentId, { audit: false });
    s.updatedBy = ctx.actorId as never;
    await s.save();
    await audit(ctx, 'student.updated', studentId, { metadata: { changedFields: fields, sensitiveChanged: fields.some((f) => SENSITIVE_FIELDS.includes(f as never)) } });
    return this.get(ctx.grants, studentId, { audit: false });
  },

  /**
   * Completes a draft registration (FRD §3.1 steps 6–8): validates everything, issues the
   * admission number and, optionally, places the student in a class, all in one transaction.
   */
  async completeRegistration(ctx: OrgActor, studentId: string, input: { assignment?: PlaceInput }) {
    await inTransaction(async (session) => {
      const s = await findStudent(ctx.organizationId, studentId, { session });
      if (s.registrationStatus === 'completed') throw ApiError.conflict('This student is already registered.', { reason: 'already_registered' });
      const guardians = (await GuardianModel.find({ organizationId: ctx.organizationId, studentId }).session(session).lean()) as GuardianLike[];
      const check = registrationChecklist(s.toObject() as StudentLike, guardians);
      if (!check.complete) throw new ApiError('REGISTRATION_INCOMPLETE', check.missing[0]!.message, { missing: check.missing });

      const admissionNumber = await admissionService.issue(ctx.organizationId, session, input.assignment?.academicYearId);
      s.admissionNumber = admissionNumber;
      s.admittedAt = new Date();
      s.status = 'active';
      s.registrationStatus = 'completed';
      s.statusChangedAt = new Date();
      s.updatedBy = ctx.actorId as never;
      await s.save({ session });
      await audit(ctx, 'student.registered', studentId, { after: { status: 'active', admissionNumber } }, session);
      await audit(ctx, 'student.admission_number_generated', studentId, { after: { admissionNumber } }, session);
      if (input.assignment) await assignmentService.placeInSession(ctx, session, s, { ...input.assignment, assignmentType: input.assignment.assignmentType ?? 'admission' });
    });
    return this.get(ctx.grants, studentId, { audit: false });
  },

  /**
   * Lifecycle changes (FRD §11). Leaving the school (transferred, withdrawn, graduated) closes
   * any open class placement with that outcome; history is kept.
   */
  async changeStatus(ctx: OrgActor, studentId: string, input: { status: StudentStatus; reason?: string; effectiveDate?: Date }) {
    await inTransaction(async (session) => {
      const s = await findStudent(ctx.organizationId, studentId, { session, includeArchived: true });
      assertNotArchived(s);
      const from = s.status;
      if (from === input.status) return;
      if (from === 'draft') throw ApiError.conflict('Complete the registration to activate this student.', { reason: 'registration_incomplete' });
      if (!STUDENT_STATUS_TRANSITIONS[from].includes(input.status)) throw ApiError.conflict(`Cannot change a student from ${from} to ${input.status}.`, { reason: 'invalid_transition' });
      if (LEAVING_STATUSES.includes(input.status) && !input.reason) throw ApiError.badRequest('Give a reason.', { reason: ['Required when a student leaves'] });
      s.status = input.status;
      s.statusReason = input.reason;
      s.statusChangedAt = new Date();
      s.updatedBy = ctx.actorId as never;
      await s.save({ session });
      let closed = 0;
      if (LEAVING_STATUSES.includes(input.status)) {
        closed = await assignmentService.closeAllForLeaving(ctx, session, studentId, input.status as 'transferred' | 'withdrawn' | 'graduated', input.effectiveDate ?? new Date());
      }
      await audit(ctx, 'student.status_changed', studentId, { before: { status: from }, after: { status: input.status }, metadata: { reason: input.reason ?? null, closedPlacements: closed } }, session);
    });
    return this.get(ctx.grants, studentId, { audit: false });
  },

  /**
   * FRD §11.1: an incomplete draft is deleted outright (with its contacts and OTPs). A registered
   * student is archived instead (soft delete) and keeps their admission number and history.
   */
  async remove(ctx: OrgActor, studentId: string, input: { reason?: string }) {
    const s = await findStudent(ctx.organizationId, studentId);
    if (s.registrationStatus === 'draft') {
      const dependents = await StudentAssignmentModel.exists({ organizationId: ctx.organizationId, studentId: s._id });
      if (dependents) throw ApiError.conflict('This draft has class placements and cannot be deleted.', { reason: 'has_dependents' });
      await inTransaction(async (session) => {
        await GuardianModel.deleteMany({ organizationId: ctx.organizationId, studentId: s._id }, { session });
        await GuardianOtpModel.deleteMany({ organizationId: ctx.organizationId, studentId: s._id }, { session });
        await s.deleteOne({ session });
        await audit(ctx, 'student.draft_deleted', studentId, { metadata: { reason: input.reason ?? null } }, session);
      });
      return { deleted: true, archived: false };
    }
    s.deletedAt = new Date();
    s.deletedBy = ctx.actorId as never;
    await s.save();
    await audit(ctx, 'student.archived', studentId, { metadata: { reason: input.reason ?? null, status: s.status } });
    return { deleted: false, archived: true };
  },

  async restore(ctx: OrgActor, studentId: string) {
    const s = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    if (!s.deletedAt) return this.get(ctx.grants, studentId, { audit: false });
    await StudentModel.updateOne({ _id: s._id }, { $unset: { deletedAt: 1, deletedBy: 1 }, $set: { updatedBy: ctx.actorId } });
    await audit(ctx, 'student.restored', studentId);
    return this.get(ctx.grants, studentId, { audit: false });
  },

  /** Audit trail for one student, including their contacts and placements (FRD §10 tab 7). */
  async history(organizationId: string, studentId: string, page: Pagination) {
    await findStudent(organizationId, studentId, { includeArchived: true });
    const filter = { organizationId: oid(organizationId), $or: [{ resource: 'student', resourceId: studentId }, { 'metadata.studentId': studentId }] };
    const [rows, total] = await Promise.all([
      AuditLogModel.find(filter).sort({ createdAt: -1 }).skip((page.page - 1) * page.limit).limit(page.limit).lean(),
      AuditLogModel.countDocuments(filter),
    ]);
    return paginated(
      rows.map((l) => ({ id: String(l._id), action: l.action, resource: l.resource, resourceId: l.resourceId ?? null, actorId: l.actorId ? String(l.actorId) : null, before: l.before ?? null, after: l.after ?? null, metadata: l.metadata ?? null, requestId: l.requestId ?? null, createdAt: l.createdAt })),
      total,
      page,
    );
  },

  /** Dashboard counts (FRD §13.1), within the viewer's scope. */
  async stats(grants: Grants, organizationId: string) {
    const scope = await studentScopeFilter(grants, 'students.read');
    const base: Record<string, unknown> = { organizationId: oid(organizationId), deletedAt: null, ...(scope && { $and: [scope] }) };
    const [byStatus, withoutPhoto, verified, currentYear] = await Promise.all([
      StudentModel.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      StudentModel.countDocuments({ ...base, status: 'active', photo: null }),
      guardianService.verifiedStudentIds(organizationId),
      AcademicYearModel.findOne({ organizationId, status: 'active' }, { name: 1 }).lean(),
    ]);
    const status = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    const active = await StudentModel.find({ ...base, status: 'active' }, { _id: 1 }).lean();
    const placed = currentYear ? new Set((await StudentAssignmentModel.distinct('studentId', { organizationId, academicYearId: currentYear._id, status: 'active' })).map(String)) : new Set<string>();
    const verifiedSet = new Set(verified.map(String));
    return {
      total: byStatus.reduce((n, r) => n + r.n, 0),
      byStatus: { draft: 0, active: 0, inactive: 0, transferred: 0, withdrawn: 0, graduated: 0, ...status },
      activeWithoutPhoto: withoutPhoto,
      activeWithoutVerifiedContact: active.filter((a) => !verifiedSet.has(String(a._id))).length,
      activeUnplacedInCurrentYear: currentYear ? active.filter((a) => !placed.has(String(a._id))).length : null,
      currentAcademicYear: currentYear ? { id: String(currentYear._id), name: currentYear.name } : null,
    };
  },

  /**
   * Teacher "My classes" (FRD §13.2): the current year's sections whose students the viewer can
   * read, with how many active students each has.
   */
  async mySections(grants: Grants, organizationId: string, academicYearId?: string) {
    const year = await resolveYear(organizationId, academicYearId);
    if (!year) return { academicYear: null, sections: [] };
    const scope = await scopeService.accessScope(grants, 'students.read');
    const q: Record<string, unknown> = { organizationId, academicYearId: year._id };
    if (!scope.organizationWide) q.unitId = { $in: [...scope.unitIds].map(oid) };
    const sections = await sectionService.list(organizationId, { academicYearId: String(year._id) });
    const allowed = new Set((await SectionModel.find(q, { _id: 1 }).lean()).map((s) => String(s._id)));
    const visible = sections.filter((s) => allowed.has(s.id));
    const counts = await StudentAssignmentModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { organizationId: oid(organizationId), status: 'active', sectionId: { $in: visible.map((s) => oid(s.id)) } } },
      { $group: { _id: '$sectionId', n: { $sum: 1 } } },
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    return {
      academicYear: { id: String(year._id), name: year.name, status: year.status },
      sections: visible.map((s) => ({ id: s.id, name: s.name, code: s.code, class: s.class, classTeacher: s.classTeacher, capacity: s.capacity, room: s.room, studentCount: countBy.get(s.id) ?? 0 })),
    };
  },
};
