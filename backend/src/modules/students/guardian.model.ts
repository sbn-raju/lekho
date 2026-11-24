import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { addressSchema } from './student.model.js';

export const GUARDIAN_RELATIONSHIPS = ['father', 'mother', 'guardian', 'other'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];
/** Relationships whose verified mobile satisfies the registration requirement (FRD §4.2). */
export const PARENTAL_RELATIONSHIPS: readonly GuardianRelationship[] = ['father', 'mother', 'guardian'];

/**
 * A parent, guardian or other authorized contact of one student.
 *
 * Verification is kept apart from the editable contact fields and records the exact number that
 * was verified. A contact counts as verified only while `verification.mobileNumber` equals the
 * current `mobileNumber`, so editing the number can never carry an old verification over
 * (OTP-010); the service also clears it explicitly.
 */
const guardianSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    studentId: { type: Types.ObjectId, ref: 'Student', required: true },
    fullName: { type: String, required: true, trim: true, maxlength: 150 },
    relationship: { type: String, enum: GUARDIAN_RELATIONSHIPS, required: true },
    /** Free-text description when relationship is "other" (e.g. "Grandmother"). */
    relationshipLabel: { type: String, trim: true, maxlength: 60 },
    /** E.164. */
    mobileNumber: { type: String, trim: true },
    alternateMobileNumber: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    occupation: { type: String, trim: true, maxlength: 100 },
    address: { type: addressSchema },
    isPrimaryContact: { type: Boolean, required: true, default: false },
    isEmergencyContact: { type: Boolean, required: true, default: false },
    verification: {
      mobileNumber: { type: String },
      verifiedAt: { type: Date },
      verifiedBy: { type: Types.ObjectId, ref: 'User' },
      method: { type: String, enum: ['otp'] },
    },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'student_guardians' },
);

guardianSchema.index({ organizationId: 1, studentId: 1 });
guardianSchema.index({ organizationId: 1, mobileNumber: 1 });
guardianSchema.index({ organizationId: 1, email: 1 });
// At most one primary contact per student.
guardianSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { isPrimaryContact: true }, name: 'one_primary_contact_per_student' });

export type Guardian = InferSchemaType<typeof guardianSchema>;
export type GuardianDocument = HydratedDocument<Guardian>;
export type GuardianLike = Guardian & { _id: Types.ObjectId };
export const GuardianModel = model('StudentGuardian', guardianSchema);

export const isGuardianVerified = (g: Pick<Guardian, 'mobileNumber' | 'verification'>) =>
  Boolean(g.mobileNumber && g.verification?.verifiedAt && g.verification.mobileNumber === g.mobileNumber);

/** A contact that satisfies the "one verified parent/guardian" rule. */
export const isVerifiedParentalContact = (g: Pick<Guardian, 'mobileNumber' | 'verification' | 'relationship'>) =>
  PARENTAL_RELATIONSHIPS.includes(g.relationship as GuardianRelationship) && isGuardianVerified(g);

export function toPublicGuardian(g: GuardianLike) {
  const verified = isGuardianVerified(g);
  return {
    id: String(g._id),
    studentId: String(g.studentId),
    fullName: g.fullName,
    relationship: g.relationship,
    relationshipLabel: g.relationshipLabel ?? null,
    mobileNumber: g.mobileNumber ?? null,
    alternateMobileNumber: g.alternateMobileNumber ?? null,
    email: g.email ?? null,
    occupation: g.occupation ?? null,
    address: g.address ?? null,
    isPrimaryContact: g.isPrimaryContact,
    isEmergencyContact: g.isEmergencyContact,
    verificationStatus: verified ? ('verified' as const) : ('unverified' as const),
    verifiedAt: verified ? g.verification!.verifiedAt! : null,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

/**
 * One OTP challenge for one guardian's mobile number (FRD §4.3, §15.6). Only a keyed hash of the
 * code is stored. A challenge is bound to the organization, guardian and exact number; sending a
 * new code supersedes older ones. Documents outlive their expiry (purged after a day by the TTL
 * index) so per-number daily limits can be counted.
 */
const otpSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    studentId: { type: Types.ObjectId, ref: 'Student', required: true },
    guardianId: { type: Types.ObjectId, ref: 'StudentGuardian', required: true },
    mobileNumber: { type: String, required: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attemptCount: { type: Number, required: true, default: 0 },
    /** How many codes were sent to this guardian before this one, within the cooldown series. */
    resendCount: { type: Number, required: true, default: 0 },
    verifiedAt: { type: Date },
    supersededAt: { type: Date },
    requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'student_guardian_otps' },
);

otpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ guardianId: 1, createdAt: -1 });
otpSchema.index({ organizationId: 1, mobileNumber: 1, createdAt: -1 });

export const GuardianOtpModel = model('StudentGuardianOtp', otpSchema);
