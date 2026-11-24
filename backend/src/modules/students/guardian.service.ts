import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { env, isProduction } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { sms } from '../notifications/sms.js';
import { GuardianModel, GuardianOtpModel, isGuardianVerified, isVerifiedParentalContact, toPublicGuardian, type GuardianLike, type GuardianRelationship } from './guardian.model.js';
import { StudentModel, type StudentDocument } from './student.model.js';
import { assertNotArchived, audit, findGuardian, findStudent, maskPhone, normalizePhone, oid } from './students.shared.js';

type Address = { line1?: string; line2?: string; city?: string; district?: string; state?: string; country?: string; postalCode?: string };

export interface GuardianInput {
  fullName?: string;
  relationship?: GuardianRelationship;
  relationshipLabel?: string | null;
  mobileNumber?: string | null;
  alternateMobileNumber?: string | null;
  email?: string | null;
  occupation?: string | null;
  address?: Address | null;
  isPrimaryContact?: boolean;
  isEmergencyContact?: boolean;
}

// Dev/test fallback pepper: per process, so codes don't survive a restart. Production requires OTP_SECRET.
const OTP_PEPPER = env.OTP_SECRET ?? randomBytes(32).toString('hex');
if (!env.OTP_SECRET && isProduction) throw new Error('OTP_SECRET is required');

/** Keyed hash bound to the challenge, so a stored hash can't be matched against another challenge. */
const hashOtp = (challengeId: string, code: string) => createHmac('sha256', OTP_PEPPER).update(`${challengeId}:${code}`).digest('hex');

function phoneOrThrow(value: string, field: string): string {
  const e164 = normalizePhone(value);
  if (!e164) throw ApiError.badRequest('Enter a valid mobile number, with the country code if it is not local.', { [field]: ['Invalid mobile number'] });
  return e164;
}

/** Fields whose change is audited by name. Values are personal data, so only names are recorded. */
const TRACKED = ['fullName', 'relationship', 'relationshipLabel', 'mobileNumber', 'alternateMobileNumber', 'email', 'occupation', 'address', 'isPrimaryContact', 'isEmergencyContact'] as const;

/**
 * Keeps one primary contact per student: if none is primary, the earliest verified parental
 * contact (else the earliest contact) becomes primary.
 */
async function ensurePrimary(organizationId: string, studentId: string, session: ClientSession) {
  const all = await GuardianModel.find({ organizationId, studentId }).sort({ createdAt: 1 }).session(session).lean();
  if (all.length === 0 || all.some((g) => g.isPrimaryContact)) return;
  const pick = all.find((g) => isVerifiedParentalContact(g)) ?? all[0]!;
  await GuardianModel.updateOne({ _id: pick._id }, { $set: { isPrimaryContact: true } }, { session });
}

export const guardianService = {
  async list(organizationId: string, studentId: string) {
    await findStudent(organizationId, studentId, { includeArchived: true });
    const rows = await GuardianModel.find({ organizationId, studentId }).sort({ isPrimaryContact: -1, createdAt: 1 }).lean();
    return rows.map((g) => toPublicGuardian(g as GuardianLike));
  },

  async get(organizationId: string, studentId: string, guardianId: string) {
    return toPublicGuardian((await findGuardian(organizationId, studentId, guardianId)).toObject() as GuardianLike);
  },

  async create(ctx: OrgActor, studentId: string, input: GuardianInput & { fullName: string; relationship: GuardianRelationship }) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    const count = await GuardianModel.countDocuments({ organizationId: ctx.organizationId, studentId });
    if (count >= 10) throw ApiError.badRequest('A student can have at most 10 contacts.');
    const mobileNumber = input.mobileNumber ? phoneOrThrow(input.mobileNumber, 'mobileNumber') : undefined;
    const alternateMobileNumber = input.alternateMobileNumber ? phoneOrThrow(input.alternateMobileNumber, 'alternateMobileNumber') : undefined;
    if (input.isPrimaryContact && !mobileNumber) throw ApiError.badRequest('The primary contact needs a mobile number.', { mobileNumber: ['Required for the primary contact'] });

    const id = await inTransaction(async (session) => {
      if (input.isPrimaryContact) await GuardianModel.updateMany({ organizationId: ctx.organizationId, studentId, isPrimaryContact: true }, { $set: { isPrimaryContact: false } }, { session });
      const [g] = await GuardianModel.create(
        [
          {
            organizationId: ctx.organizationId,
            studentId,
            fullName: input.fullName,
            relationship: input.relationship,
            relationshipLabel: input.relationship === 'other' ? (input.relationshipLabel ?? undefined) : undefined,
            mobileNumber,
            alternateMobileNumber,
            email: input.email ?? undefined,
            occupation: input.occupation ?? undefined,
            address: input.address ?? undefined,
            isPrimaryContact: Boolean(input.isPrimaryContact) || count === 0,
            isEmergencyContact: Boolean(input.isEmergencyContact),
            createdBy: ctx.actorId,
          },
        ],
        { session },
      );
      await ensurePrimary(ctx.organizationId, studentId, session);
      await audit(ctx, 'guardian.added', String(g!._id), { metadata: { studentId, relationship: input.relationship } }, session);
      return String(g!._id);
    });
    return this.get(ctx.organizationId, studentId, id);
  },

  async update(ctx: OrgActor, studentId: string, guardianId: string, input: GuardianInput) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    await inTransaction(async (session) => {
      const g = await findGuardian(ctx.organizationId, studentId, guardianId, session);
      const before = g.toObject();
      const wasVerified = isGuardianVerified(g);

      if (input.fullName !== undefined) g.fullName = input.fullName;
      if (input.relationship !== undefined) g.relationship = input.relationship;
      if (input.relationshipLabel !== undefined || input.relationship !== undefined) g.relationshipLabel = g.relationship === 'other' ? (input.relationshipLabel ?? g.relationshipLabel ?? undefined) : undefined;
      if (input.mobileNumber !== undefined) {
        const next = input.mobileNumber ? phoneOrThrow(input.mobileNumber, 'mobileNumber') : undefined;
        if (next !== g.mobileNumber) {
          g.mobileNumber = next;
          // OTP-010: a changed number is unverified; also void any code sent to the old number.
          g.set('verification', undefined);
          await GuardianOtpModel.updateMany({ guardianId: g._id, verifiedAt: null, supersededAt: null }, { $set: { supersededAt: new Date() } }, { session });
        }
      }
      if (input.alternateMobileNumber !== undefined) g.alternateMobileNumber = input.alternateMobileNumber ? phoneOrThrow(input.alternateMobileNumber, 'alternateMobileNumber') : undefined;
      if (input.email !== undefined) g.email = input.email ?? undefined;
      if (input.occupation !== undefined) g.occupation = input.occupation ?? undefined;
      if (input.address !== undefined) g.set('address', input.address ?? undefined);
      if (input.isEmergencyContact !== undefined) g.isEmergencyContact = input.isEmergencyContact;
      if (input.isPrimaryContact === true && !g.isPrimaryContact) {
        if (!g.mobileNumber) throw ApiError.badRequest('The primary contact needs a mobile number.', { mobileNumber: ['Required for the primary contact'] });
        await GuardianModel.updateMany({ organizationId: ctx.organizationId, studentId, isPrimaryContact: true }, { $set: { isPrimaryContact: false } }, { session });
        g.isPrimaryContact = true;
      } else if (input.isPrimaryContact === false && g.isPrimaryContact) {
        throw ApiError.badRequest('Choose another contact as primary instead; a student always has one primary contact.', { isPrimaryContact: ['Pick a different primary contact'] });
      }
      if (g.isPrimaryContact && !g.mobileNumber) throw ApiError.badRequest('The primary contact needs a mobile number.', { mobileNumber: ['Required for the primary contact'] });

      // Editing the only verified contact's number is allowed (numbers do change); the student
      // then shows as needing re-verification rather than the edit being refused.
      await g.save({ session });

      const changed = TRACKED.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(g.get(f) ?? null));
      if (changed.length) await audit(ctx, 'guardian.updated', guardianId, { metadata: { studentId, changedFields: changed } }, session);
      if (changed.includes('mobileNumber')) {
        await audit(ctx, 'guardian.mobile_changed', guardianId, { metadata: { studentId, verificationCleared: wasVerified, to: g.mobileNumber ? maskPhone(g.mobileNumber) : null } }, session);
      }
    });
    return this.get(ctx.organizationId, studentId, guardianId);
  },

  /**
   * A registered student must keep at least one verified parent/guardian (FRD §4.2), so removing
   * the last one is refused. (Editing their number is allowed; the school then re-verifies.)
   */
  async assertRegisteredStudentKeepsVerifiedContact(student: StudentDocument, guardianId: string, session: ClientSession) {
    if (student.registrationStatus !== 'completed') return;
    const others = await GuardianModel.find({ organizationId: student.organizationId, studentId: student._id, _id: { $ne: oid(guardianId) } }).session(session).lean();
    if (!others.some((g) => isVerifiedParentalContact(g))) {
      throw ApiError.conflict('This is the only verified parent or guardian. Add and verify another contact first.', { reason: 'last_verified_contact' });
    }
  },

  async remove(ctx: OrgActor, studentId: string, guardianId: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    await inTransaction(async (session) => {
      const g = await findGuardian(ctx.organizationId, studentId, guardianId, session);
      await this.assertRegisteredStudentKeepsVerifiedContact(student, guardianId, session);
      await g.deleteOne({ session });
      await GuardianOtpModel.deleteMany({ guardianId: g._id }, { session });
      await ensurePrimary(ctx.organizationId, studentId, session);
      await audit(ctx, 'guardian.removed', guardianId, { metadata: { studentId, relationship: g.relationship, wasVerified: isGuardianVerified(g) } }, session);
    });
  },

  // ---------- OTP (FRD §4.3) ----------

  /**
   * Sends a fresh code to the guardian's current number. Limits: a cooldown between sends to one
   * guardian (OTP-005), and a daily cap per number per school. A new code supersedes older ones.
   */
  async sendOtp(ctx: OrgActor, studentId: string, guardianId: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    const g = await findGuardian(ctx.organizationId, studentId, guardianId);
    if (!g.mobileNumber) throw ApiError.badRequest('Add a mobile number for this contact first.', { mobileNumber: ['Required'] });
    if (isGuardianVerified(g)) throw ApiError.conflict('This mobile number is already verified.', { reason: 'already_verified' });

    const now = Date.now();
    const last = await GuardianOtpModel.findOne({ guardianId: g._id }).sort({ createdAt: -1 }).lean();
    const cooldownMs = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    if (last && last.mobileNumber === g.mobileNumber && last.createdAt && now - last.createdAt.getTime() < cooldownMs) {
      const retryAfterSeconds = Math.ceil((cooldownMs - (now - last.createdAt.getTime())) / 1000);
      throw new ApiError('RATE_LIMITED', `Please wait ${retryAfterSeconds} seconds before sending another code.`, { reason: 'otp_cooldown', retryAfterSeconds });
    }
    const sentToday = await GuardianOtpModel.countDocuments({ organizationId: ctx.organizationId, mobileNumber: g.mobileNumber, createdAt: { $gte: new Date(now - 86_400_000) } });
    if (sentToday >= env.OTP_MAX_REQUESTS_PER_DAY) {
      await audit(ctx, 'guardian.otp_limited', guardianId, { metadata: { studentId, reason: 'daily_limit' } });
      throw new ApiError('RATE_LIMITED', 'Too many codes have been sent to this number today. Try again tomorrow.', { reason: 'otp_daily_limit' });
    }

    const code = String(randomInt(0, 10 ** env.OTP_LENGTH)).padStart(env.OTP_LENGTH, '0');
    const challenge = new GuardianOtpModel({
      organizationId: ctx.organizationId,
      studentId,
      guardianId: g._id,
      mobileNumber: g.mobileNumber,
      otpHash: 'pending',
      expiresAt: new Date(now + env.OTP_TTL_SECONDS * 1000),
      resendCount: last && last.mobileNumber === g.mobileNumber && !last.verifiedAt ? last.resendCount + 1 : 0,
      requestedBy: ctx.actorId,
      purgeAt: new Date(now + 86_400_000),
    });
    challenge.otpHash = hashOtp(String(challenge._id), code);
    await inTransaction(async (session) => {
      await GuardianOtpModel.updateMany({ guardianId: g._id, verifiedAt: null, supersededAt: null }, { $set: { supersededAt: new Date() } }, { session });
      await challenge.save({ session });
    });

    const org = await OrganizationModel.findById(ctx.organizationId, { name: 1 }).lean();
    const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
    try {
      await sms.send({ to: g.mobileNumber, text: `${code} is the code to confirm this number as a contact for ${student.firstName} at ${org?.name ?? 'school'}. Valid for ${minutes} min. Share it only with the school office.` });
    } catch (err) {
      await GuardianOtpModel.updateOne({ _id: challenge._id }, { $set: { supersededAt: new Date() } });
      await audit(ctx, 'guardian.otp_send_failed', guardianId, { metadata: { studentId } });
      throw err;
    }
    await audit(ctx, 'guardian.otp_sent', guardianId, { metadata: { studentId, to: maskPhone(g.mobileNumber), resendCount: challenge.resendCount } });
    return {
      sentTo: maskPhone(g.mobileNumber),
      expiresAt: challenge.expiresAt,
      resendAvailableAt: new Date(now + cooldownMs),
      attemptsAllowed: env.OTP_MAX_ATTEMPTS,
      codeLength: env.OTP_LENGTH,
    };
  },

  /**
   * Checks a code. Each attempt is counted atomically before comparing, so parallel guesses can't
   * exceed the limit; a correct code is consumed atomically, so it works once (OTP-003). The
   * code must have been sent to the guardian's *current* number (OTP-009).
   */
  async verifyOtp(ctx: OrgActor, studentId: string, guardianId: string, code: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    const g = await findGuardian(ctx.organizationId, studentId, guardianId);
    if (isGuardianVerified(g)) throw ApiError.conflict('This mobile number is already verified.', { reason: 'already_verified' });

    const fail = async (error: ApiError, reason: string) => {
      await audit(ctx, 'guardian.otp_failed', guardianId, { metadata: { studentId, reason } });
      throw error;
    };

    const now = new Date();
    const open = { guardianId: g._id, organizationId: oid(ctx.organizationId), verifiedAt: null, supersededAt: null };
    const latest = await GuardianOtpModel.findOne(open).sort({ createdAt: -1 }).lean();
    if (!latest || latest.mobileNumber !== g.mobileNumber) return fail(new ApiError('OTP_INVALID', 'No code is pending for this number. Send a new code.', { reason: 'no_pending_code' }), 'no_pending_code');
    if (latest.expiresAt <= now) return fail(new ApiError('OTP_EXPIRED', 'This code has expired. Send a new code.', { reason: 'expired' }), 'expired');

    const counted = await GuardianOtpModel.findOneAndUpdate(
      { _id: latest._id, verifiedAt: null, supersededAt: null, attemptCount: { $lt: env.OTP_MAX_ATTEMPTS } },
      { $inc: { attemptCount: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!counted) return fail(new ApiError('OTP_LOCKED', 'Too many incorrect attempts. Send a new code.', { reason: 'attempts_exceeded' }), 'attempts_exceeded');

    const expected = Buffer.from(counted.otpHash, 'hex');
    const actual = Buffer.from(hashOtp(String(counted._id), code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attemptsRemaining = env.OTP_MAX_ATTEMPTS - counted.attemptCount;
      return fail(new ApiError('OTP_INVALID', attemptsRemaining > 0 ? 'Incorrect code.' : 'Incorrect code. Send a new code.', { reason: 'mismatch', attemptsRemaining }), 'mismatch');
    }

    await inTransaction(async (session) => {
      const consumed = await GuardianOtpModel.updateOne({ _id: counted._id, verifiedAt: null, supersededAt: null }, { $set: { verifiedAt: new Date() } }, { session });
      if (consumed.modifiedCount !== 1) throw new ApiError('OTP_INVALID', 'This code has already been used. Send a new code.', { reason: 'used' });
      // The number may have changed since the code was sent; only verify the number it went to.
      const updated = await GuardianModel.updateOne(
        { _id: g._id, mobileNumber: counted.mobileNumber },
        { $set: { verification: { mobileNumber: counted.mobileNumber, verifiedAt: new Date(), verifiedBy: oid(ctx.actorId), method: 'otp' } } },
        { session },
      );
      if (updated.modifiedCount !== 1) throw new ApiError('OTP_INVALID', 'The mobile number changed after the code was sent. Send a new code.', { reason: 'number_changed' });
      await audit(ctx, 'guardian.mobile_verified', guardianId, { metadata: { studentId, mobile: maskPhone(counted.mobileNumber), method: 'otp' } }, session);
    });
    await StudentModel.updateOne({ _id: student._id }, { $set: { updatedBy: ctx.actorId } });
    return this.get(ctx.organizationId, studentId, guardianId);
  },

  /** Summaries for lists: primary contact and verification state per student. */
  async summaries(organizationId: string, studentIds: string[]) {
    const rows = studentIds.length ? await GuardianModel.find({ organizationId, studentId: { $in: studentIds.map(oid) } }).lean() : [];
    const out = new Map<string, { primaryContact: { name: string; relationship: string; mobileNumber: string | null; verified: boolean } | null; hasVerifiedContact: boolean; contactCount: number }>();
    for (const id of studentIds) out.set(id, { primaryContact: null, hasVerifiedContact: false, contactCount: 0 });
    for (const g of rows) {
      const entry = out.get(String(g.studentId))!;
      entry.contactCount++;
      if (isVerifiedParentalContact(g)) entry.hasVerifiedContact = true;
      if (g.isPrimaryContact) entry.primaryContact = { name: g.fullName, relationship: g.relationship, mobileNumber: g.mobileNumber ?? null, verified: isGuardianVerified(g) };
    }
    return out;
  },

  /** Students with (or without) a verified parent/guardian, for the verification filter. */
  async verifiedStudentIds(organizationId: string) {
    return GuardianModel.distinct('studentId', {
      organizationId: oid(organizationId),
      relationship: { $in: ['father', 'mother', 'guardian'] },
      'verification.verifiedAt': { $ne: null },
      $expr: { $eq: ['$verification.mobileNumber', '$mobileNumber'] },
    });
  },
};
