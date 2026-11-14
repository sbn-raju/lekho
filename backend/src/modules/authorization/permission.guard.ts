import type { Request, RequestHandler } from 'express';
import { ApiError } from '../../common/errors/ApiError.js';
import { requestMeta, requireAuth, requireOrg } from '../../common/utils/request.js';
import type { OrgActor } from '../memberships/membership.service.js';
import type { RoleActor } from '../roles/role.service.js';
import { getPermissionDefinition } from '../permissions/permission.catalog.js';
import { authorizationService, hasPermission, type Grants } from './authorization.service.js';
import { scopeService } from './scope.service.js';

/** Grants for the current request, resolved once and memoized on the request. */
export async function requestGrants(req: Request, level: Grants['level']): Promise<Grants> {
  req.grants ??= {};
  if (!req.grants[level]) {
    if (level === 'platform') {
      req.grants.platform = await authorizationService.platformGrants(requireAuth(req).userId);
    } else {
      // organizationContext has already validated organization status and membership.
      const { organizationId, roleIds, unitIds } = requireOrg(req);
      const grants = await authorizationService.rolesGrants('organization', roleIds, organizationId);
      grants.subject = { userId: requireAuth(req).userId, organizationId, unitIds };
      req.grants.organization = grants;
    }
  }
  return req.grants[level]!;
}

/**
 * Route guard: `requirePermission('users.create')`. Organization permissions need
 * `organizationContext` earlier in the chain; platform permissions need only `authenticate`.
 * With several codes, all are required.
 */
export function requirePermission(...codes: string[]): RequestHandler {
  const defs = codes.map((code) => {
    const def = getPermissionDefinition(code);
    // Fail at startup, not at request time, if a route names an unregistered permission.
    if (!def) throw new Error(`requirePermission: "${code}" is not in the permission catalog`);
    return def;
  });
  return async (req, _res, next) => {
    for (const def of defs) {
      const grants = await requestGrants(req, def.level);
      if (!hasPermission(grants, def.code)) {
        throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.', { requiredPermission: def.code });
      }
    }
    next();
  };
}

// ---------- Actor builders for services that apply escalation rules ----------

export async function orgActor(req: Request): Promise<OrgActor> {
  return {
    organizationId: requireOrg(req).organizationId,
    actorId: requireAuth(req).userId,
    grants: await requestGrants(req, 'organization'),
    meta: requestMeta(req),
  };
}

export async function platformActor(req: Request): Promise<RoleActor> {
  return { actorId: requireAuth(req).userId, grants: await requestGrants(req, 'platform'), meta: requestMeta(req) };
}

/**
 * Resource-level guard (FRD §10.4 steps 7–8): the resource named by `req.params[param]` must
 * belong to this organization (else 404) and fall inside the caller's scope for `code` (else 403).
 * Use after `requirePermission(code)`.
 */
export function requireScope(code: string, param = 'id', notFoundMessage = 'Resource not found'): RequestHandler {
  if (!getPermissionDefinition(code)?.scopedResource) throw new Error(`requireScope: "${code}" has no scoped resource`);
  return async (req, _res, next) => {
    await scopeService.assertResource(await requestGrants(req, 'organization'), code, String(req.params[param]), notFoundMessage);
    next();
  };
}

/** Mongo filter limiting a memberships query to the caller's scope for `code` (null = unrestricted). */
export async function scopedMembershipFilter(req: Request, code: string, kind: 'user' | 'membership') {
  return scopeService.membershipFilter(await requestGrants(req, 'organization'), code, kind);
}
