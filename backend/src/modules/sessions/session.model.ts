import { Schema, Types, model, type InferSchemaType } from 'mongoose';

export const SESSION_STATUSES = ['active', 'revoked', 'expired'] as const;
export const CLIENT_TYPES = ['web', 'mobile'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

/**
 * One authenticated device (FRD §13.3). The session is the refresh-token family: every rotation
 * replaces `refreshTokenHash`, and presenting any older token from the family revokes the session.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    /** Random, unguessable ID carried in the refresh token so the session can be found without a hash scan. */
    tokenFamilyId: { type: String, required: true },
    refreshTokenHash: { type: String, required: true },
    /** The hash that was current before the last rotation; tolerated briefly for concurrent refreshes. */
    previousRefreshTokenHash: { type: String },
    rotatedAt: { type: Date },
    /** SHA-256 of the CSRF token for cookie-based refresh (web). Bound to the session so it can't be forged via cookie injection. */
    csrfTokenHash: { type: String },
    clientType: { type: String, enum: CLIENT_TYPES, required: true, default: 'web' },
    /** Organization selected via POST /me/active-organization. Re-validated on every request. */
    activeOrganizationId: { type: Types.ObjectId, ref: 'Organization' },
    deviceName: { type: String, maxlength: 200 },
    deviceType: { type: String, maxlength: 100 },
    ipAddress: { type: String },
    userAgent: { type: String },
    status: { type: String, enum: SESSION_STATUSES, required: true, default: 'active' },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'sessions' },
);

sessionSchema.index({ userId: 1, status: 1 });
sessionSchema.index({ tokenFamilyId: 1 }, { unique: true });
// Keep expired/revoked sessions for 30 days for security review, then let MongoDB purge them.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('Session', sessionSchema);
