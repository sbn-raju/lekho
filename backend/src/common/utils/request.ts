import type { Request } from 'express';
import { ApiError } from '../errors/ApiError.js';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  /** Correlation ID for the request (X-Request-Id), recorded on audit entries. */
  requestId?: string;
}

export function requestMeta(req: Request): RequestMeta {
  const ua = req.get('user-agent');
  return { ipAddress: req.ip, userAgent: ua ? ua.slice(0, 512) : undefined, requestId: req.requestId };
}

/** Returns the authenticated principal, or throws if the route was mounted without `authenticate`. */
export function requireAuth(req: Request) {
  if (!req.auth) throw ApiError.unauthenticated();
  return req.auth;
}

/** Returns the validated organization context, or throws if the route was mounted without `organizationContext`. */
export function requireOrg(req: Request) {
  if (!req.org) throw new ApiError('ORGANIZATION_CONTEXT_REQUIRED', 'Select an organization first.');
  return req.org;
}
