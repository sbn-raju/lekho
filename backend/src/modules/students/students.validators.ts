import { z } from 'zod';
import { objectId, paginationQuery } from '../../common/utils/pagination.js';
import { BLOOD_GROUPS, GENDERS, STUDENT_STATUSES } from './student.model.js';
import { GUARDIAN_RELATIONSHIPS } from './guardian.model.js';
import { ASSIGNMENT_TYPES, ID_CARD_FIELDS } from './assignment.model.js';

/** Calendar date "YYYY-MM-DD", stored as UTC midnight. */
const date = z.iso.date('Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00.000Z`));
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional text that can be cleared with null or "". */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

const address = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,12}$/, 'Invalid PIN / postal code').optional().or(z.literal('')),
});

export const studentIdParams = z.object({ studentId: objectId });
export const guardianParams = z.object({ studentId: objectId, guardianId: objectId });
export const assignmentParams = z.object({ studentId: objectId, assignmentId: objectId });
export const templateParams = z.object({ templateId: z.union([objectId, z.literal('standard')]) });
export const yearParams = z.object({ yearId: objectId });

const studentFields = {
  middleName: clearable(80).optional(),
  lastName: text(80).optional(),
  dateOfBirth: date.optional(),
  gender: z.enum(GENDERS).optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
  nationality: clearable(60).optional(),
  motherTongue: clearable(60).optional(),
  religion: clearable(60).optional(),
  casteCategory: clearable(40).optional(),
  caste: clearable(100).optional(),
  medicalNotes: clearable(2000).optional(),
  residentialAddress: address.optional(),
  permanentAddress: address.nullable().optional(),
  permanentSameAsResidential: z.boolean().optional(),
  previousSchool: clearable(200).optional(),
  previousClass: clearable(60).optional(),
};

/** A draft needs only a first name; the rest is checked when registration is completed. */
export const createStudentSchema = z.object({ firstName: text(80), ...studentFields });
export const updateStudentSchema = z
  .object({ firstName: text(80).optional(), ...studentFields })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const placement = z.object({
  academicYearId: objectId,
  classId: objectId,
  sectionId: objectId,
  startDate: date.optional(),
  assignmentType: z.enum(ASSIGNMENT_TYPES).optional(),
  notes: z.string().trim().max(500).optional(),
  allowOverCapacity: z.boolean().optional(),
});

export const completeRegistrationSchema = z.object({ assignment: placement.optional() });
export const statusSchema = z.object({ status: z.enum(STUDENT_STATUSES).exclude(['draft']), reason: z.string().trim().max(500).optional(), effectiveDate: date.optional() });
export const deleteStudentSchema = z.object({ reason: z.string().trim().max(500).optional() });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export const listStudentsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  academicYearId: objectId.optional(),
  classId: objectId.optional(),
  sectionId: objectId.optional(),
  gender: z.enum(GENDERS).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  verification: z.enum(['verified', 'unverified']).optional(),
  archived: bool.optional(),
  sort: z.enum(['name', 'admissionNumber', 'recent']).default('name'),
});
export const yearStudentsQuery = listStudentsQuery.omit({ academicYearId: true });
export const historyQuery = paginationQuery;
export const mySectionsQuery = z.object({ academicYearId: objectId.optional() });

// ----- Guardians -----

const phone = z.string().trim().min(6).max(20);
const guardianFields = {
  relationshipLabel: clearable(60).optional(),
  mobileNumber: phone.nullable().optional(),
  alternateMobileNumber: phone.nullable().optional(),
  email: z.email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  occupation: clearable(100).optional(),
  address: address.nullable().optional(),
  isPrimaryContact: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
};
export const createGuardianSchema = z.object({ fullName: text(150), relationship: z.enum(GUARDIAN_RELATIONSHIPS), ...guardianFields });
export const updateGuardianSchema = z
  .object({ fullName: text(150).optional(), relationship: z.enum(GUARDIAN_RELATIONSHIPS).optional(), ...guardianFields })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const verifyOtpSchema = z.object({ otp: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS') });

// ----- Assignments -----

export const createAssignmentSchema = placement;
export const correctAssignmentSchema = z
  .object({
    classId: objectId.optional(),
    sectionId: objectId.optional(),
    startDate: date.optional(),
    endDate: date.nullable().optional(),
    notes: clearable(500).optional(),
    reason: text(500),
  })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to correct');
export const closeAssignmentSchema = z.object({ outcome: z.enum(['promoted', 'retained']), endDate: date.optional() });
export const transferSchema = z.object({ sectionId: objectId, effectiveDate: date.optional(), reason: z.string().trim().max(500).optional(), allowOverCapacity: z.boolean().optional() });
export const bulkPromoteSchema = z.object({
  fromSectionId: objectId,
  toSectionId: objectId,
  studentIds: z.array(objectId).min(1).max(500).optional(),
  assignmentType: z.enum(['promotion', 'retention']).optional(),
  allowOverCapacity: z.boolean().optional(),
});

// ----- Admission numbers & settings -----

export const admissionSettingsSchema = z
  .object({
    format: z.string().trim().min(5).max(60).optional(),
    sequencePadding: z.number().int().min(1).max(10).optional(),
    casteCategories: z.array(text(40)).min(1).max(30).optional(),
    allowUndisclosedGender: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const admissionPreviewQuery = z.object({ academicYearId: objectId.optional() });
export const correctAdmissionSchema = z.object({ admissionNumber: z.string().trim().regex(/^[A-Za-z0-9\-/_.]{1,40}$/, 'Letters, digits and - / _ . only'), reason: text(500) });

// ----- Photos -----

export const photoAuthSchema = z.object({ studentId: objectId });
export const savePhotoSchema = z.object({ fileId: z.string().trim().min(1).max(100) });

// ----- ID cards -----

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1F4FD8');
const templateFields = {
  layout: z.enum(['portrait', 'landscape']).optional(),
  primaryColor: color.optional(),
  accentColor: color.optional(),
  textColor: color.optional(),
  backgroundColor: color.optional(),
  photoPosition: z.enum(['left', 'center', 'right']).optional(),
  fields: z.array(z.enum(ID_CARD_FIELDS)).max(ID_CARD_FIELDS.length).optional(),
  showBackSide: z.boolean().optional(),
  backText: clearable(600).optional(),
  signatureLabel: clearable(60).optional(),
  validUntil: date.nullable().optional(),
  isDefault: z.boolean().optional(),
};
export const createTemplateSchema = z.object({ name: text(80), ...templateFields });
export const updateTemplateSchema = z.object({ name: text(80).optional(), ...templateFields }).refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const idCardQuery = z.object({ templateId: z.union([objectId, z.literal('standard')]).optional() });
export const generateIdCardSchema = z.object({ templateId: z.union([objectId, z.literal('standard')]).optional() });
export const bulkIdCardSchema = z
  .object({
    academicYearId: objectId.optional(),
    classId: objectId.optional(),
    sectionId: objectId.optional(),
    studentIds: z.array(objectId).min(1).max(500).optional(),
    includeInactive: z.boolean().optional(),
    templateId: z.union([objectId, z.literal('standard')]).optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((v) => v.academicYearId || v.classId || v.sectionId || v.studentIds, 'Pick an academic year, class, section or students');
