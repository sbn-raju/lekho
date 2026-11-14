import { rateLimit, type Options } from 'express-rate-limit';
import { ApiError } from '../errors/ApiError.js';
import { isTest } from '../../config/env.js';

/**
 * Per-IP limiters for credential and recovery endpoints (FRD §4.3, §17). Per-account brute force is
 * handled separately by credential lockout. The default store is in-memory: with more than one API
 * instance, switch to a shared store (e.g. rate-limit-redis) so limits apply across instances.
 */
function limiter(windowMinutes: number, limit: number, overrides: Partial<Options> = {}) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, _res, next) => next(new ApiError('RATE_LIMITED', 'Too many requests. Please try again later.')),
    ...overrides,
  });
}

export const rateLimits = {
  login: limiter(15, 20),
  refresh: limiter(15, 120),
  /** forgot-password, resend-verification: these send email, so keep them tight. */
  emailSending: limiter(60, 5),
  /** verify-email, reset-password: token-guessing protection. */
  tokenRedemption: limiter(15, 20),
  changePassword: limiter(15, 10),
};
