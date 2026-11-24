import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/**
 * Student lifecycle (Student FRD §11).
 *
 *   draft ──complete registration──▶ active ⇄ inactive
 *                                      │  ▲
 *                                      ▼  │ re-admit
 *                          transferred / withdrawn / graduated
 *
 * Drafts are incomplete registrations: no admission number, never in class lists. Only the
 * registration workflow moves a student out of draft. Archiving (soft delete, `deletedAt`) is
 * separate from status so an archived record keeps the status it had.
 */
export const STUDENT_STATUSES = ['draft', 'active', 'inactive', 'transferred', 'withdrawn', 'graduated'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const STUDENT_STATUS_TRANSITIONS: Record<StudentStatus, readonly StudentStatus[]> = {
  draft: [],
  active: ['inactive', 'transferred', 'withdrawn', 'graduated'],
  inactive: ['active', 'transferred', 'withdrawn', 'graduated'],
  transferred: ['active'],
  withdrawn: ['active'],
  graduated: ['active'],
};

/** Statuses that end the student's time at the school, closing any open class placement. */
export const LEAVING_STATUSES: readonly StudentStatus[] = ['transferred', 'withdrawn', 'graduated'];

export const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    country: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 12 },
  },
  { _id: false },
);

const photoSchema = new Schema(
  {
    fileId: { type: String, required: true },
    filePath: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    uploadedAt: { type: Date, required: true },
    uploadedBy: { type: Types.ObjectId, ref: 'User', required: true },
    /** Bumped on every replacement; used to bust caches of rendered ID cards. */
    version: { type: Number, required: true, default: 1 },
  },
  { _id: false },
);

const admissionHistorySchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    changedBy: { type: Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, required: true },
  },
  { _id: false },
);

const studentSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    /** Assigned once registration completes; never reused, even after archiving. */
    admissionNumber: { type: String, trim: true },
    admissionNumberHistory: { type: [admissionHistorySchema], default: [] },
    admittedAt: { type: Date },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    middleName: { type: String, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    /** Lower-cased "first middle last", for search. */
    searchName: { type: String, required: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS },
    bloodGroup: { type: String, enum: BLOOD_GROUPS },
    nationality: { type: String, trim: true, maxlength: 60 },
    motherTongue: { type: String, trim: true, maxlength: 60 },
    // --- Sensitive (students.read_sensitive). Never on ID cards or ordinary views. ---
    religion: { type: String, trim: true, maxlength: 60 },
    /** One of the school's configured categories (see student settings). */
    casteCategory: { type: String, trim: true, maxlength: 40 },
    caste: { type: String, trim: true, maxlength: 100 },
    medicalNotes: { type: String, trim: true, maxlength: 2000 },
    // ---
    addresses: {
      residential: { type: addressSchema },
      permanent: { type: addressSchema },
      permanentSameAsResidential: { type: Boolean, default: true },
    },
    previousSchool: { type: String, trim: true, maxlength: 200 },
    previousClass: { type: String, trim: true, maxlength: 60 },
    photo: { type: photoSchema },
    status: { type: String, enum: STUDENT_STATUSES, required: true, default: 'draft' },
    registrationStatus: { type: String, enum: ['draft', 'completed'], required: true, default: 'draft' },
    statusReason: { type: String, trim: true, maxlength: 500 },
    statusChangedAt: { type: Date },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
    /** Archived (soft-deleted). Archived students are hidden from lists unless asked for. */
    deletedAt: { type: Date },
    deletedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'students' },
);

// Unique within the school; archived students keep theirs, so numbers are never reused.
studentSchema.index(
  { organizationId: 1, admissionNumber: 1 },
  { unique: true, partialFilterExpression: { admissionNumber: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } },
);
studentSchema.index({ organizationId: 1, deletedAt: 1, status: 1, searchName: 1 });
studentSchema.index({ organizationId: 1, searchName: 1 });

export type Student = InferSchemaType<typeof studentSchema>;
export type StudentDocument = HydratedDocument<Student>;
export type StudentLike = Student & { _id: Types.ObjectId };
export const StudentModel = model('Student', studentSchema);

export const fullName = (s: { firstName: string; middleName?: string | null; lastName?: string | null }) =>
  [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

export const searchNameOf = (s: { firstName: string; middleName?: string | null; lastName?: string | null }) =>
  fullName(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Whole years between `dob` and `on` (UTC calendar dates). */
export function ageOn(dob: Date, on = new Date()): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
