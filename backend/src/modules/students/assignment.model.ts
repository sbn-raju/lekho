import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * A student's placement in one class and section for one academic year (FRD §7).
 *
 *  - `active`     the current placement for that year. At most one per student per year
 *                 (partial unique index), so two overlapping placements can't exist.
 *  - `superseded` closed by an in-year transfer; the next placement follows it.
 *  - `completed`  the year ended for this placement, with an `outcome`.
 *
 * History is never overwritten: a transfer closes one placement and opens another, and a
 * correction edits in place with an audit record of before/after.
 */
export const ASSIGNMENT_STATUSES = ['active', 'superseded', 'completed'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_TYPES = ['admission', 'promotion', 'retention', 'transfer', 'readmission', 'placement'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];
export const ASSIGNMENT_OUTCOMES = ['promoted', 'retained', 'transferred', 'withdrawn', 'graduated'] as const;
export type AssignmentOutcome = (typeof ASSIGNMENT_OUTCOMES)[number];

const correctionSchema = new Schema(
  {
    reason: { type: String, required: true, maxlength: 500 },
    before: { type: Schema.Types.Mixed, required: true },
    correctedBy: { type: Types.ObjectId, ref: 'User', required: true },
    correctedAt: { type: Date, required: true },
  },
  { _id: false },
);

const assignmentSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    studentId: { type: Types.ObjectId, ref: 'Student', required: true },
    academicYearId: { type: Types.ObjectId, ref: 'AcademicYear', required: true },
    classId: { type: Types.ObjectId, ref: 'SchoolClass', required: true },
    sectionId: { type: Types.ObjectId, ref: 'Section', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: { type: String, enum: ASSIGNMENT_STATUSES, required: true, default: 'active' },
    assignmentType: { type: String, enum: ASSIGNMENT_TYPES, required: true, default: 'placement' },
    outcome: { type: String, enum: ASSIGNMENT_OUTCOMES },
    /** The placement this one replaced (in-year transfer). */
    previousAssignmentId: { type: Types.ObjectId, ref: 'StudentAssignment' },
    notes: { type: String, trim: true, maxlength: 500 },
    corrections: { type: [correctionSchema], default: [] },
    assignedBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'student_academic_assignments' },
);

assignmentSchema.index(
  { organizationId: 1, studentId: 1, academicYearId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_assignment_per_student_year' },
);
assignmentSchema.index({ organizationId: 1, studentId: 1, startDate: -1 });
assignmentSchema.index({ organizationId: 1, academicYearId: 1, sectionId: 1, status: 1 });
assignmentSchema.index({ organizationId: 1, sectionId: 1, status: 1 });

export type StudentAssignment = InferSchemaType<typeof assignmentSchema>;
export type StudentAssignmentDocument = HydratedDocument<StudentAssignment>;
export const StudentAssignmentModel = model('StudentAssignment', assignmentSchema);

/**
 * Atomic sequence per school and number series (FRD §6.4). `key` is the rendered format without
 * its sequence (e.g. "LEKHO-2026-"), so each prefix numbers from 1 and a format change can never
 * collide with numbers already issued. Counters only ever increase: numbers are never reused.
 */
const admissionCounterSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, required: true },
    academicYearId: { type: Types.ObjectId, ref: 'AcademicYear' },
    currentSequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'admission_counters' },
);
admissionCounterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
export const AdmissionCounterModel = model('AdmissionCounter', admissionCounterSchema);

export const DEFAULT_ADMISSION_FORMAT = '{SCHOOL_CODE}-{YEAR}-{SEQ}';
export const DEFAULT_CASTE_CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'Other', 'Not disclosed'];

/** Per-school student settings: admission number format and configurable value lists. */
const studentSettingsSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    admissionNumber: {
      format: { type: String, required: true, default: DEFAULT_ADMISSION_FORMAT, maxlength: 60 },
      sequencePadding: { type: Number, required: true, min: 1, max: 10, default: 4 },
    },
    casteCategories: { type: [String], default: () => [...DEFAULT_CASTE_CATEGORIES] },
    /** Whether "Prefer not to disclose" is offered for gender. */
    allowUndisclosedGender: { type: Boolean, required: true, default: true },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'student_settings' },
);
studentSettingsSchema.index({ organizationId: 1 }, { unique: true });
export const StudentSettingsModel = model('StudentSettings', studentSettingsSchema);

// ---------- ID cards ----------

/** Fields an ID card template may show. Sensitive data (caste, religion, OTPs…) is not among them. */
export const ID_CARD_FIELDS = [
  'admissionNumber',
  'class',
  'section',
  'academicYear',
  'dateOfBirth',
  'bloodGroup',
  'schoolAddress',
  'schoolPhone',
  'schoolEmail',
  'emergencyContact',
  'validUntil',
] as const;
export type IdCardField = (typeof ID_CARD_FIELDS)[number];
export const DEFAULT_ID_CARD_FIELDS: IdCardField[] = ['admissionNumber', 'class', 'section', 'academicYear', 'dateOfBirth', 'bloodGroup', 'schoolAddress', 'schoolPhone'];

const hexColor = { type: String, match: /^#[0-9a-fA-F]{6}$/ };

const idCardTemplateSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    layout: { type: String, enum: ['portrait', 'landscape'], required: true, default: 'portrait' },
    primaryColor: { ...hexColor, required: true, default: '#1F4FD8' },
    accentColor: { ...hexColor, required: true, default: '#F5B700' },
    textColor: { ...hexColor, required: true, default: '#1A1D23' },
    backgroundColor: { ...hexColor, required: true, default: '#FFFFFF' },
    photoPosition: { type: String, enum: ['left', 'center', 'right'], required: true, default: 'center' },
    fields: { type: [String], enum: ID_CARD_FIELDS, default: () => [...DEFAULT_ID_CARD_FIELDS] },
    showBackSide: { type: Boolean, required: true, default: false },
    backText: { type: String, trim: true, maxlength: 600 },
    signatureLabel: { type: String, trim: true, maxlength: 60, default: 'Principal' },
    /** Card validity, e.g. "31 Mar 2027", when `validUntil` is shown. Defaults to the year end. */
    validUntil: { type: Date },
    isDefault: { type: Boolean, required: true, default: false },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'id_card_templates' },
);
idCardTemplateSchema.index({ organizationId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
idCardTemplateSchema.index({ organizationId: 1 }, { unique: true, partialFilterExpression: { isDefault: true }, name: 'one_default_template' });
export type IdCardTemplate = InferSchemaType<typeof idCardTemplateSchema>;
export const IdCardTemplateModel = model('IdCardTemplate', idCardTemplateSchema);

/**
 * Record of each generated card (FRD §15.5). Cards are rendered on demand from current data, so
 * no file is stored: `generatedFilePath` stays empty unless a storage backend is added later.
 */
const idCardSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    studentId: { type: Types.ObjectId, ref: 'Student', required: true },
    academicAssignmentId: { type: Types.ObjectId, ref: 'StudentAssignment', required: true },
    templateId: { type: Types.ObjectId, ref: 'IdCardTemplate' },
    generatedFilePath: { type: String },
    batchId: { type: String },
    version: { type: Number, required: true },
    generatedBy: { type: Types.ObjectId, ref: 'User', required: true },
    generatedAt: { type: Date, required: true },
  },
  { collection: 'student_id_cards' },
);
idCardSchema.index({ organizationId: 1, studentId: 1, version: -1 });
export const StudentIdCardModel = model('StudentIdCard', idCardSchema);
