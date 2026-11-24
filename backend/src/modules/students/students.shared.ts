import { Types, type ClientSession } from 'mongoose';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { auditService } from '../audit/audit.service.js';
import type { OrgActor } from '../memberships/membership.service.js';
import type { Grants } from '../authorization/authorization.service.js';
import { hasPermission } from '../authorization/authorization.service.js';
import { registerScopeResolver, scopeService } from '../authorization/scope.service.js';
import { SectionModel } from '../academics/section.model.js';
import { StudentModel } from './student.model.js';
import { StudentAssignmentModel } from './assignment.model.js';
import { GuardianModel } from './guardian.model.js';

export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

type AuditData = { before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown> };

/**
 * Audits a student-module action. `action` is "<resource>.<verb>". Record only field names and
 * non-sensitive values: never OTPs, and never religion, caste or medical notes (FRD §17).
 */
export function audit(ctx: OrgActor, action: `${'student' | 'guardian' | 'student_assignment' | 'student_settings' | 'id_card' | 'id_card_template'}.${string}`, resourceId: string | undefined, data: AuditData = {}, session?: ClientSession) {
  const resource = action.slice(0, action.indexOf('.'));
  return auditService.record({ actorId: ctx.actorId, organizationId: ctx.organizationId, action, resource, resourceId, result: 'success', ...data, meta: ctx.meta }, session);
}

/** Finds a student of this school. Archived students are found only when `includeArchived`. */
export async function findStudent(organizationId: string, id: string, opts: { includeArchived?: boolean; session?: ClientSession } = {}) {
  const student = Types.ObjectId.isValid(id)
    ? await StudentModel.findOne({ _id: id, organizationId, ...(!opts.includeArchived && { deletedAt: null }) }).session(opts.session ?? null)
    : null;
  if (!student) throw ApiError.notFound('Student not found');
  return student;
}

export async function findGuardian(organizationId: string, studentId: string, guardianId: string, session?: ClientSession) {
  const g = Types.ObjectId.isValid(guardianId) ? await GuardianModel.findOne({ _id: guardianId, organizationId, studentId }).session(session ?? null) : null;
  if (!g) throw ApiError.notFound('Parent or guardian not found');
  return g;
}

export function assertNotArchived(student: { deletedAt?: Date | null }) {
  if (student.deletedAt) throw ApiError.conflict('This student is archived. Restore the record first.', { reason: 'student_archived' });
}

/**
 * Normalizes a phone number to E.164. Local numbers (10 digits, or 0 + 10 digits) get the
 * default country code. Returns null for anything that isn't a plausible number.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const plus = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  const cc = env.DEFAULT_PHONE_COUNTRY_CODE;
  let e164: string;
  if (plus) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+${cc}${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) e164 = `+${cc}${digits.slice(1)}`;
  else if (digits.length === cc.length + 10 && digits.startsWith(cc)) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** "+919876543210" → "+91 ••••••3210", for audit records and SMS confirmations. */
export const maskPhone = (e164: string) => `${e164.slice(0, -10) || e164.slice(0, 3)} ••••••${e164.slice(-4)}`;

// ---------- Scope ----------

/** Section units a student is currently placed in (active placements only). */
async function studentUnitIds(organizationId: string, studentId: string): Promise<string[]> {
  const active = await StudentAssignmentModel.find({ organizationId, studentId, status: 'active' }, { sectionId: 1 }).lean();
  if (active.length === 0) return [];
  const sections = await SectionModel.find({ organizationId, _id: { $in: active.map((a) => a.sectionId) } }, { unitId: 1 }).lean();
  return sections.map((s) => String(s.unitId));
}

/**
 * A student is "in" the hierarchy unit of the section they're currently placed in. So section
 * scope over 10 A, class scope over Grade 10, or "assigned" for a teacher placed in 10 A's unit
 * (class teachers are) all cover that student. Students without a current placement, including
 * drafts, are visible only organization-wide.
 */
registerScopeResolver('student', async (organizationId, studentId) => {
  if (!Types.ObjectId.isValid(studentId)) return null;
  const s = await StudentModel.findOne({ _id: studentId, organizationId }, { _id: 1 }).lean();
  return s ? { id: studentId, organizationId, unitIds: await studentUnitIds(organizationId, studentId), ownerIds: [] } : null;
});

/**
 * Mongo filter on students limiting a query to the actor's scope for `code`, or null when
 * unrestricted. Applied server-side to every list and bulk operation, so query parameters can't
 * widen what a teacher sees (FRD §2.2).
 */
export async function studentScopeFilter(grants: Grants, code: string): Promise<Record<string, unknown> | null> {
  if (!hasPermission(grants, code)) return { _id: { $in: [] } };
  const scope = await scopeService.accessScope(grants, code);
  if (scope.organizationWide) return null;
  const ids = new Set<string>([...scope.resourceIds].filter((id) => Types.ObjectId.isValid(id)));
  if (scope.unitIds.size) {
    const sections = await SectionModel.find({ organizationId: grants.organizationId, unitId: { $in: [...scope.unitIds].map(oid) } }, { _id: 1 }).lean();
    if (sections.length) {
      const placed = await StudentAssignmentModel.distinct('studentId', { organizationId: grants.organizationId, status: 'active', sectionId: { $in: sections.map((s) => s._id) } });
      for (const id of placed) ids.add(String(id));
    }
  }
  return { _id: { $in: [...ids].map(oid) } };
}

/** Whether `code` covers this one student, without throwing. */
export async function canOnStudent(grants: Grants, code: string, studentId: string): Promise<boolean> {
  return (await scopeService.evaluate(grants, code, studentId)).allowed;
}
