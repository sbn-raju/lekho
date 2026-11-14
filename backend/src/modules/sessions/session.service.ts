import { Types } from 'mongoose';
import { SessionModel, type ClientType } from './session.model.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { randomToken, safeEqualHex, sha256 } from '../../common/utils/crypto.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { auditService } from '../audit/audit.service.js';

/**
 * Refresh tokens are opaque: `<tokenFamilyId>.<secret>`. The family ID locates the session; only
 * SHA-256(token) is stored. Rotation replaces the hash, so an older token from the same family
 * that shows up again is evidence of theft and revokes the whole session (FRD §4.5).
 */
function newRefreshToken(tokenFamilyId: string) {
  const token = `${tokenFamilyId}.${randomToken()}`;
  return { token, hash: sha256(token) };
}

function parseFamilyId(token: string): string | null {
  const [familyId, secret, extra] = token.split('.');
  return familyId && secret && extra === undefined ? familyId : null;
}

export type RefreshResult =
  | { kind: 'rotated'; userId: string; sessionId: string; refreshToken: string; clientType: ClientType }
  /** A concurrent request already rotated this token moments ago; issue an access token but no new refresh token. */
  | { kind: 'grace'; userId: string; sessionId: string; clientType: ClientType };

export type RevokeReason = 'logout' | 'logout_all' | 'user_revoked' | 'password_changed' | 'password_reset' | 'reuse_detected';

export const sessionService = {
  async create(input: { userId: string; clientType: ClientType; deviceName?: string; meta: RequestMeta }) {
    const tokenFamilyId = randomToken(24);
    const { token, hash } = newRefreshToken(tokenFamilyId);
    const csrfToken = input.clientType === 'web' ? randomToken() : undefined;
    const now = new Date();
    const session = await SessionModel.create({
      userId: input.userId,
      tokenFamilyId,
      refreshTokenHash: hash,
      csrfTokenHash: csrfToken && sha256(csrfToken),
      clientType: input.clientType,
      deviceName: input.deviceName,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      status: 'active',
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
    return { sessionId: String(session._id), refreshToken: token, csrfToken };
  },

  /**
   * @param csrfToken Required when the refresh token arrived in a cookie (pass `null` if the header was missing);
   *                  `undefined` when it came in the request body (mobile), where CSRF doesn't apply.
   */
  async rotate(presentedToken: string, csrfToken: string | null | undefined, meta: RequestMeta): Promise<RefreshResult> {
    const familyId = parseFamilyId(presentedToken);
    if (!familyId) throw ApiError.unauthenticated('Invalid refresh token');

    const session = await SessionModel.findOne({ tokenFamilyId: familyId });
    if (!session) throw ApiError.unauthenticated('Invalid refresh token');

    const now = new Date();
    if (session.status !== 'active' || session.expiresAt <= now) {
      throw ApiError.unauthenticated('Session is no longer active');
    }

    if (csrfToken !== undefined) {
      if (!csrfToken || !session.csrfTokenHash || !safeEqualHex(sha256(csrfToken), session.csrfTokenHash)) {
        throw new ApiError('CSRF_INVALID', 'Missing or invalid CSRF token.');
      }
    }

    const presentedHash = sha256(presentedToken);
    const base = { userId: String(session.userId), sessionId: String(session._id), clientType: session.clientType };

    if (safeEqualHex(presentedHash, session.refreshTokenHash)) {
      const { token, hash } = newRefreshToken(familyId);
      // Compare-and-swap on the current hash: if another request rotated first, this matches nothing.
      const updated = await SessionModel.findOneAndUpdate(
        { _id: session._id, status: 'active', refreshTokenHash: presentedHash },
        {
          $set: {
            refreshTokenHash: hash,
            previousRefreshTokenHash: presentedHash,
            rotatedAt: now,
            lastUsedAt: now,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
        },
        { returnDocument: 'after' },
      );
      if (updated) return { kind: 'rotated', ...base, refreshToken: token };
      // Lost the race: re-read to decide whether this is a benign concurrent refresh.
      const latest = await SessionModel.findById(session._id);
      if (latest && this.isWithinGrace(latest, presentedHash, now)) return { kind: 'grace', ...base };
    } else if (this.isWithinGrace(session, presentedHash, now)) {
      return { kind: 'grace', ...base };
    }

    await this.revokeSession(String(session._id), 'reuse_detected');
    await auditService.record({
      actorId: base.userId,
      action: 'auth.refresh_token.reuse_detected',
      resource: 'session',
      resourceId: base.sessionId,
      result: 'failure',
      meta,
    });
    throw new ApiError('TOKEN_REUSED', 'Refresh token reuse detected. The session has been revoked; please sign in again.');
  },

  isWithinGrace(
    session: { status: string; previousRefreshTokenHash?: string | null; rotatedAt?: Date | null },
    presentedHash: string,
    now: Date,
  ): boolean {
    return (
      session.status === 'active' &&
      !!session.previousRefreshTokenHash &&
      !!session.rotatedAt &&
      safeEqualHex(presentedHash, session.previousRefreshTokenHash) &&
      now.getTime() - session.rotatedAt.getTime() <= env.REFRESH_REUSE_GRACE_SECONDS * 1000
    );
  },

  /** Returns the session if active and unexpired. Checked on every authenticated request so revocation is immediate. */
  async findActive(sessionId: string, userId: string) {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    return SessionModel.findOne(
      { _id: sessionId, userId, status: 'active', expiresAt: { $gt: new Date() } },
      { activeOrganizationId: 1 },
    ).lean();
  },

  async setActiveOrganization(sessionId: string, organizationId: string | null): Promise<void> {
    await SessionModel.updateOne(
      { _id: sessionId },
      organizationId ? { $set: { activeOrganizationId: organizationId } } : { $unset: { activeOrganizationId: 1 } },
    );
  },

  async revokeSession(sessionId: string, reason: RevokeReason, userId?: string): Promise<boolean> {
    const res = await SessionModel.updateOne(
      { _id: sessionId, status: 'active', ...(userId && { userId }) },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: reason } },
    );
    return res.modifiedCount === 1;
  },

  async revokeAllForUser(userId: string, reason: RevokeReason, options: { exceptSessionId?: string } = {}) {
    const res = await SessionModel.updateMany(
      { userId, status: 'active', ...(options.exceptSessionId && { _id: { $ne: options.exceptSessionId } }) },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: reason } },
    );
    return res.modifiedCount;
  },

  async listActive(userId: string, currentSessionId: string) {
    const sessions = await SessionModel.find({ userId, status: 'active', expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .lean();
    return sessions.map((s) => ({
      id: String(s._id),
      current: String(s._id) === currentSessionId,
      clientType: s.clientType,
      deviceName: s.deviceName ?? null,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
    }));
  },
};
