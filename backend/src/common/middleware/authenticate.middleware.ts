import type { RequestHandler } from 'express';
import { ApiError } from '../errors/ApiError.js';
import { tokenService } from '../../modules/auth/token.service.js';
import { UserModel } from '../../modules/users/user.model.js';
import { sessionService } from '../../modules/sessions/session.service.js';

/**
 * Validates `Authorization: Bearer <jwt>`, then confirms against the database that the user is
 * still active, the token version is current, and the session hasn't been revoked. The DB checks
 * make suspension and logout effective immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) throw ApiError.unauthenticated();

  const claims = await tokenService.verifyAccessToken(match[1]);

  const user = await UserModel.findById(claims.userId, { status: 1, emailVerified: 1, tokenVersion: 1 }).lean();
  if (!user || user.tokenVersion !== claims.tokenVersion) throw ApiError.unauthenticated('Session is no longer valid');
  if (user.status !== 'active' || !user.emailVerified) {
    throw new ApiError('ACCOUNT_DISABLED', 'This account is not active.');
  }
  const session = await sessionService.findActive(claims.sessionId, claims.userId);
  if (!session) throw ApiError.unauthenticated('Session is no longer valid');

  req.auth = {
    userId: claims.userId,
    sessionId: claims.sessionId,
    activeOrganizationId: session.activeOrganizationId ? String(session.activeOrganizationId) : undefined,
  };
  next();
};

/**
 * Like `authenticate`, but lets anonymous requests through (req.auth stays unset).
 * A token that is present but invalid is still rejected, so clients learn to refresh it.
 */
export const optionalAuthenticate: RequestHandler = async (req, res, next) => {
  if (!req.get('authorization')) return next();
  return authenticate(req, res, next);
};
