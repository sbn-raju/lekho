import { Types } from 'mongoose';
import { getPermissionDefinition, ORGANIZATION_PERMISSION_CODES, PLATFORM_PERMISSION_CODES } from '../permissions/permission.catalog.js';
import { RoleModel, SCHOOL_ADMIN_ROLE_CODE } from '../roles/role.model.js';
import { UserModel } from '../users/user.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { MembershipModel, isMembershipUsable } from '../memberships/membership.model.js';
import { PlatformMembershipModel } from '../platform/platform-membership.model.js';
import { platformAdminService } from '../platform/platform-admin.model.js';
import type { ScopeRule } from './scope.types.js';
import { scopeService } from './scope.service.js';

/**
 * What a principal (or a role set) is allowed to do at one level.
 * `all` means every catalog permission of that level, including ones added later.
 */
export interface Grants {
  level: 'organization' | 'platform';
  all: boolean;
  codes: Set<string>;
  roles: { id: string; name: string; code: string }[];
  /** Why `all` is set, for diagnostics. */
  via?: 'super_admin' | 'school_admin';
  /** Union of scope rules per permission across roles. `all` implies organization-wide for every code. */
  rules: Map<string, ScopeRule[]>;
  /** Organization the grants apply to (organization level). */
  organizationId?: string;
  /** Set for a real principal's grants (not a bare role set): needed to resolve relative scopes. */
  subject?: { userId: string; organizationId: string; unitIds: string[] };
}

export interface AuthorizationRequest {
  userId: string;
  organizationId?: string;
  permission: string;
  /** With resourceId: evaluate scope for that resource (FRD §10.4 steps 7–8). */
  resourceType?: string;
  resourceId?: string;
  context?: { departmentId?: string; classId?: string; sectionId?: string };
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  matchedRoles?: string[];
  matchedPermissions?: string[];
  scope?: string;
}

export const EMPTY = (level: Grants['level']): Grants => ({ level, all: false, codes: new Set(), roles: [], rules: new Map() });

export function hasPermission(grants: Grants, code: string): boolean {
  return grants.all || grants.codes.has(code);
}

export function grantedCodes(grants: Grants): string[] {
  const universe = grants.level === 'organization' ? ORGANIZATION_PERMISSION_CODES : PLATFORM_PERMISSION_CODES;
  return grants.all ? [...universe] : universe.filter((c) => grants.codes.has(c));
}

/**
 * Central authorization engine (FRD §15). Deny by default; always reads current roles and
 * memberships from the database (tokens carry no permissions), so changes apply immediately.
 */
export const authorizationService = {
  /** Union of permissions granted by the given roles. Inactive and foreign roles contribute nothing. */
  async rolesGrants(level: Grants['level'], roleIds: (string | Types.ObjectId)[], organizationId?: string): Promise<Grants> {
    const grants = EMPTY(level);
    if (level === 'organization') grants.organizationId = organizationId;
    if (roleIds.length === 0) return grants;
    const roles = await RoleModel.find({
      _id: { $in: roleIds },
      type: level,
      status: 'active',
      ...(level === 'organization' ? { organizationId } : {}),
    }).lean();
    for (const role of roles) {
      grants.roles.push({ id: String(role._id), name: role.name, code: role.code });
      if (level === 'organization' && role.isSystem && role.code === SCHOOL_ADMIN_ROLE_CODE) {
        grants.all = true;
        grants.via = 'school_admin';
      }
      // Codes no longer in the catalog are ignored, even if a stale role still lists them.
      for (const p of role.permissions) {
        if (getPermissionDefinition(p.code)?.level !== level) continue;
        grants.codes.add(p.code);
        const rules = grants.rules.get(p.code) ?? [];
        const scopes = p.scopes?.length ? p.scopes : [{ type: level, resourceIds: [] }];
        for (const s of scopes) rules.push({ type: s.type, resourceIds: (s.resourceIds ?? []).map(String) });
        grants.rules.set(p.code, rules);
      }
    }
    return grants;
  },

  /** Platform grants: Super Admin holds everything; staff hold their active platform roles. */
  async platformGrants(userId: string): Promise<Grants> {
    if (await platformAdminService.isSuperAdmin(userId)) {
      return { ...EMPTY('platform'), all: true, via: 'super_admin' };
    }
    const membership = await PlatformMembershipModel.findOne({ userId, status: 'active' }).lean();
    return membership ? this.rolesGrants('platform', membership.roles) : EMPTY('platform');
  },

  /** Organization grants for a user, after validating organization status and membership. */
  async organizationGrants(userId: string, organizationId: string): Promise<{ grants: Grants; denial?: string }> {
    if (!Types.ObjectId.isValid(organizationId)) return { grants: EMPTY('organization'), denial: 'invalid_organization' };
    const [org, membership] = await Promise.all([
      OrganizationModel.findById(organizationId, { status: 1 }).lean(),
      MembershipModel.findOne({ userId, organizationId }).lean(),
    ]);
    if (!org || !membership) return { grants: EMPTY('organization'), denial: 'not_a_member' };
    if (org.status !== 'active') return { grants: EMPTY('organization'), denial: 'organization_inactive' };
    if (!isMembershipUsable(membership)) return { grants: EMPTY('organization'), denial: 'membership_inactive' };
    const grants = await this.rolesGrants('organization', membership.roles, organizationId);
    grants.subject = { userId, organizationId, unitIds: (membership.organizationUnitIds ?? []).map(String) };
    return { grants };
  },

  /** Full FRD §15.1 sequence for a single permission. */
  async check(req: AuthorizationRequest): Promise<AuthorizationResult> {
    const def = getPermissionDefinition(req.permission);
    if (!def) return { allowed: false, reason: 'unknown_permission' };

    const user = await UserModel.findById(req.userId, { status: 1, emailVerified: 1 }).lean();
    if (!user || user.status !== 'active' || !user.emailVerified) return { allowed: false, reason: 'user_inactive' };

    let grants: Grants;
    if (def.level === 'platform') {
      grants = await this.platformGrants(req.userId);
    } else {
      if (!req.organizationId) return { allowed: false, reason: 'organization_context_required' };
      const res = await this.organizationGrants(req.userId, req.organizationId);
      if (res.denial) return { allowed: false, reason: res.denial };
      grants = res.grants;
      if (req.resourceId) {
        // Resource-level decision: tenant ownership, then scope (FRD §10.4 steps 7–8).
        const r = await scopeService.evaluate(grants, req.permission, req.resourceId, req.resourceType);
        if (!r.allowed) return { allowed: false, reason: r.reason };
        return { ...this.evaluate(grants, req.permission), scope: r.scope.join(',') };
      }
    }
    return this.evaluate(grants, req.permission);
  },

  evaluate(grants: Grants, permission: string): AuthorizationResult {
    const def = getPermissionDefinition(permission);
    if (!def || def.level !== grants.level) return { allowed: false, reason: 'unknown_permission' };
    if (!hasPermission(grants, permission)) return { allowed: false, reason: 'permission_not_granted' };
    return {
      allowed: true,
      reason: grants.via ?? 'role_permission',
      matchedRoles: grants.all && grants.via === 'super_admin' ? [] : grants.roles.map((r) => r.code),
      matchedPermissions: [permission],
      // Without a resource, report the scope types granted (e.g. "department,own").
      scope: grants.all
        ? def.level
        : [...new Set((grants.rules.get(permission) ?? []).map((r) => r.type))].join(',') || def.level,
    };
  },
};
