import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { auditService } from '../audit/audit.service.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { AcademicYearModel, EDITABLE_YEAR_STATUSES, type AcademicYearDocument } from './academic-year.model.js';
import { SchoolClassModel } from './class.model.js';
import { SectionModel } from './section.model.js';

export const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** `action` is "<resource>.<verb>", e.g. "section.created". */
export function audit(
  ctx: OrgActor,
  action: `${'academic_year' | 'class' | 'section'}.${string}`,
  resourceId: string | undefined,
  data: { before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown> } = {},
) {
  const resource = action.slice(0, action.indexOf('.'));
  return auditService.record({ actorId: ctx.actorId, organizationId: ctx.organizationId, action, resource, resourceId, result: 'success', ...data, meta: ctx.meta });
}

export async function findYear(organizationId: string, id: string) {
  const year = Types.ObjectId.isValid(id) ? await AcademicYearModel.findOne({ _id: id, organizationId }) : null;
  if (!year) throw ApiError.notFound('Academic year not found');
  return year;
}

export async function findClass(organizationId: string, id: string) {
  const cls = Types.ObjectId.isValid(id) ? await SchoolClassModel.findOne({ _id: id, organizationId }) : null;
  if (!cls) throw ApiError.notFound('Class not found');
  return cls;
}

export async function findSection(organizationId: string, id: string) {
  const section = Types.ObjectId.isValid(id) ? await SectionModel.findOne({ _id: id, organizationId }) : null;
  if (!section) throw ApiError.notFound('Section not found');
  return section;
}

/** Completed and archived years are history: their structure can't change. */
export function assertYearEditable(year: AcademicYearDocument | { name: string; status: string }) {
  if (!EDITABLE_YEAR_STATUSES.includes(year.status as never)) {
    throw ApiError.conflict(`${year.name} is ${year.status}. Reopen it to make changes.`, { reason: 'year_locked', status: year.status });
  }
}

/**
 * The year a request is about: the one asked for, else the current (active) year, else the most
 * recent planned year, so a school setting up its first year sees it before activating it.
 */
export async function resolveYear(organizationId: string, academicYearId?: string) {
  if (academicYearId) return (await findYear(organizationId, academicYearId)).toObject();
  return (
    (await AcademicYearModel.findOne({ organizationId, status: 'active' }).lean()) ??
    (await AcademicYearModel.findOne({ organizationId, status: 'planned' }).sort({ startDate: 1 }).lean())
  );
}

export const yearSummary = (y: { _id: unknown; name: string; status: string } | null) => (y ? { id: String(y._id), name: y.name, status: y.status } : null);

/** "A".."Z", then "AA".."AZ"… for alphabetic section names. */
export function alphabeticName(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Turns free text into a code: "AY 2026/27" → "AY-2026-27". */
export function toCode(value: string, max: number): string {
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}
