import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { getPermissionDefinition } from '../permissions/permission.catalog.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationUnitModel, type OrganizationUnitType } from '../organization-units/organization-unit.model.js';
import { hasPermission, type Grants } from './authorization.service.js';
import type { AccessScope, ResourceAttributes, ScopeRule, ScopeType } from './scope.types.js';

/**
 * Scope engine (FRD §10). Permissions say *what*; scopes say *which resources*.
 *
 *   organization  every resource in the school
 *   department    resources in the listed departments, or (no IDs) in the actor's own departments
 *   class         … classes (sections inside a class are included)
 *   section       … sections
 *   assigned      resources in any unit the actor belongs to, or that list the actor as assigned
 *   own           resources the actor owns
 *   custom        exactly the listed resource IDs
 *
 * Unit scopes include each unit's whole subtree (Mathematics is inside Academic). Inactive units
 * grant nothing. Resources are described by per-type resolvers, so domain modules (students,
 * classes, assignments…) plug in by calling `registerScopeResolver` without engine changes.
 */

type Resolver = (organizationId: string, resourceId: string) => Promise<ResourceAttributes | null>;
const resolvers = new Map<string, Resolver>();

export function registerScopeResolver(resourceType: string, resolver: Resolver): void {
  resolvers.set(resourceType, resolver);
}

const oid = (id: string) => new Types.ObjectId(id);
const validIds = (ids: string[]) => ids.filter((id) => Types.ObjectId.isValid(id));

// ----- Built-in IAM resolvers -----

/** A school member, addressed by user ID. They own their own record. */
registerScopeResolver('user', async (organizationId, userId) => {
  if (!Types.ObjectId.isValid(userId)) return null;
  const m = await MembershipModel.findOne({ organizationId, userId }, { organizationUnitIds: 1 }).lean();
  return m
    ? { id: userId, organizationId, unitIds: (m.organizationUnitIds ?? []).map(String), ownerIds: [userId] }
    : null;
});

registerScopeResolver('membership', async (organizationId, membershipId) => {
  if (!Types.ObjectId.isValid(membershipId)) return null;
  const m = await MembershipModel.findOne({ _id: membershipId, organizationId }, { organizationUnitIds: 1, userId: 1 }).lean();
  return m
    ? { id: membershipId, organizationId, unitIds: (m.organizationUnitIds ?? []).map(String), ownerIds: [String(m.userId)] }
    : null;
});

/** A unit is "in" itself, so department scope over X covers X and everything below it. */
registerScopeResolver('organization_unit', async (organizationId, unitId) => {
  if (!Types.ObjectId.isValid(unitId)) return null;
  const u = await OrganizationUnitModel.findOne({ _id: unitId, organizationId }, { _id: 1 }).lean();
  return u ? { id: unitId, organizationId, unitIds: [unitId], ownerIds: [] } : null;
});

const UNIT_SCOPE_TYPES: Partial<Record<ScopeType, OrganizationUnitType>> = {
  department: 'department',
  class: 'class',
  section: 'section',
};

export const scopeService = {
  /** Active units among `seedIds` (optionally of one type) plus all their active descendants. */
  async expandUnits(organizationId: string, seedIds: string[], type?: OrganizationUnitType): Promise<Set<string>> {
    const ids = validIds(seedIds);
    if (ids.length === 0) return new Set();
    const seeds = await OrganizationUnitModel.find(
      { organizationId, _id: { $in: ids.map(oid) }, status: 'active', ...(type && { type }) },
      { _id: 1 },
    ).lean();
    if (seeds.length === 0) return new Set();
    const seedOids = seeds.map((s) => s._id);
    const descendants = await OrganizationUnitModel.find({ organizationId, ancestors: { $in: seedOids }, status: 'active' }, { _id: 1 }).lean();
    return new Set([...seedOids, ...descendants.map((d) => d._id)].map(String));
  },

  /** Resolves an actor's rules for one permission into concrete sets. Memoized per Grants object. */
  async accessScope(grants: Grants, code: string): Promise<AccessScope> {
    const cache = (grants as Grants & { _scopeCache?: Map<string, Promise<AccessScope>> })._scopeCache ?? new Map();
    (grants as Grants & { _scopeCache?: Map<string, Promise<AccessScope>> })._scopeCache = cache;
    if (!cache.has(code)) cache.set(code, this.computeScope(grants, code));
    return cache.get(code)!;
  },

  async computeScope(grants: Grants, code: string): Promise<AccessScope> {
    const scope: AccessScope = { organizationWide: false, unitIds: new Set(), own: false, assignedToActor: false, resourceIds: new Set(), types: [] };
    if (grants.all) return { ...scope, organizationWide: true, types: ['organization'] };
    const rules = grants.rules.get(code) ?? [];
    if (rules.some((r) => r.type === 'organization' || r.type === 'platform')) {
      return { ...scope, organizationWide: true, types: ['organization'] };
    }
    const subject = grants.subject;
    for (const rule of rules) {
      scope.types.push(rule.type);
      const unitType = UNIT_SCOPE_TYPES[rule.type];
      const orgId = grants.organizationId;
      if (unitType) {
        // Explicit units, or (no IDs) the actor's own units of that type.
        const seeds = rule.resourceIds.length ? rule.resourceIds : (subject?.unitIds ?? []);
        if (orgId) for (const id of await this.expandUnits(orgId, seeds, unitType)) scope.unitIds.add(id);
      } else if (rule.type === 'assigned') {
        if (subject) {
          for (const id of await this.expandUnits(subject.organizationId, subject.unitIds)) scope.unitIds.add(id);
          scope.assignedToActor = true;
        }
      } else if (rule.type === 'own') {
        scope.own = true;
      } else if (rule.type === 'custom') {
        for (const id of rule.resourceIds) scope.resourceIds.add(id);
      }
    }
    return scope;
  },

  inScope(scope: AccessScope, attrs: ResourceAttributes, actorId: string | undefined): boolean {
    if (scope.organizationWide) return true;
    if (attrs.unitIds.some((u) => scope.unitIds.has(u))) return true;
    if (scope.own && actorId && attrs.ownerIds.includes(actorId)) return true;
    if (scope.assignedToActor && actorId && attrs.assignedUserIds?.includes(actorId)) return true;
    return scope.resourceIds.has(attrs.id);
  },

  async resolve(resourceType: string, organizationId: string, resourceId: string): Promise<ResourceAttributes | null> {
    const resolver = resolvers.get(resourceType);
    if (!resolver) throw new Error(`No scope resolver registered for "${resourceType}"`);
    const attrs = await resolver(organizationId, resourceId);
    // Tenant isolation (FRD §15.2 rule 7): a resource from another organization doesn't exist here.
    return attrs && attrs.organizationId === organizationId ? attrs : null;
  },

  /**
   * Evaluates permission + scope for one resource without throwing. `notFound` means the
   * resource doesn't exist in this organization.
   */
  async evaluate(grants: Grants, code: string, resourceId: string, resourceType?: string) {
    const def = getPermissionDefinition(code);
    const organizationId = grants.organizationId;
    if (!def || def.level !== 'organization' || !organizationId) return { allowed: false, reason: 'unknown_permission' } as const;
    const type = def.scopedResource ?? resourceType;
    if (!type || !resolvers.has(type)) return { allowed: false, reason: 'unknown_resource_type' } as const;
    const attrs = await this.resolve(type, organizationId, resourceId);
    if (!attrs) return { allowed: false, reason: 'not_found', notFound: true } as const;
    if (!hasPermission(grants, code)) return { allowed: false, reason: 'permission_not_granted' } as const;
    // Permissions without a scoped resource only ever carry organization scope.
    if (!def.scopedResource) return { allowed: true, reason: 'organization', scope: ['organization'] as ScopeType[] } as const;
    const scope = await this.accessScope(grants, code);
    return this.inScope(scope, attrs, grants.subject?.userId)
      ? ({ allowed: true, reason: 'in_scope', scope: scope.types } as const)
      : ({ allowed: false, reason: 'out_of_scope' } as const);
  },

  /** Throws 404 for resources outside the tenant and 403 for resources outside the actor's scope. */
  async assertResource(grants: Grants, code: string, resourceId: string, notFoundMessage = 'Resource not found') {
    const result = await this.evaluate(grants, code, resourceId);
    if ('notFound' in result) throw ApiError.notFound(notFoundMessage);
    if (!result.allowed) {
      throw new ApiError('FORBIDDEN', 'This is outside the part of the school you can manage.', {
        reason: result.reason,
        requiredPermission: code,
      });
    }
  },

  /**
   * Query filter restricting a memberships query to the actor's scope for `code`, or `null` for
   * no restriction. `kind` says what custom-scope IDs refer to.
   */
  async membershipFilter(grants: Grants, code: string, kind: 'user' | 'membership'): Promise<Record<string, unknown> | null> {
    const scope = await this.accessScope(grants, code);
    if (scope.organizationWide) return null;
    const or: Record<string, unknown>[] = [];
    if (scope.unitIds.size) or.push({ organizationUnitIds: { $in: [...scope.unitIds].map(oid) } });
    if (scope.own && grants.subject) or.push({ userId: oid(grants.subject.userId) });
    const custom = validIds([...scope.resourceIds]).map(oid);
    if (custom.length) or.push(kind === 'user' ? { userId: { $in: custom } } : { _id: { $in: custom } });
    return or.length ? { $or: or } : { _id: { $in: [] } };
  },

  /**
   * Validates and normalizes scope rules for an organization role grant (FRD §10.3, scope builder).
   * Unscoped permissions accept only organization scope; unit IDs must be units of the right type
   * in this organization; custom IDs must be real resources of the permission's type here.
   */
  async validateRules(organizationId: string, code: string, raw: { type: string; resourceIds?: string[] }[]): Promise<ScopeRule[]> {
    const def = getPermissionDefinition(code);
    if (!def || def.level !== 'organization') throw ApiError.badRequest(`Unknown permission ${code}.`);
    if (raw.length === 0) throw ApiError.badRequest(`At least one scope is required for ${code}.`);
    const rules: ScopeRule[] = [];
    for (const r of raw) {
      const ids = [...new Set(r.resourceIds ?? [])];
      if (r.type === 'organization') return [{ type: 'organization', resourceIds: [] }];
      if (!def.scopedResource) {
        throw ApiError.badRequest(`${code} can only be granted organization-wide.`, { permission: code });
      }
      if (validIds(ids).length !== ids.length) throw ApiError.badRequest('Invalid resource id in scope.');
      const unitType = UNIT_SCOPE_TYPES[r.type as ScopeType];
      if (unitType) {
        if (ids.length) {
          const count = await OrganizationUnitModel.countDocuments({ organizationId, _id: { $in: ids.map(oid) }, type: unitType });
          if (count !== ids.length) throw ApiError.badRequest(`Scope ${r.type} lists units that are not ${unitType}s of this organization.`, { permission: code });
        }
      } else if (r.type === 'custom') {
        if (!ids.length) throw ApiError.badRequest('Custom scope needs at least one resource.', { permission: code });
        for (const id of ids) {
          if (!(await this.resolve(def.scopedResource, organizationId, id))) {
            throw ApiError.badRequest(`Custom scope lists a resource that doesn't exist in this organization.`, { permission: code, resourceId: id });
          }
        }
      } else if (r.type === 'assigned' || r.type === 'own') {
        if (ids.length) throw ApiError.badRequest(`Scope ${r.type} does not take resource ids.`);
      } else {
        throw ApiError.badRequest(`Scope type ${r.type} is not valid for organization roles.`);
      }
      rules.push({ type: r.type as ScopeType, resourceIds: ids });
    }
    const seen = new Set<string>();
    return rules.filter((r) => {
      const key = `${r.type}:${[...r.resourceIds].sort().join(',')}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
  },

  /**
   * Can `actor` hand out `code` with `targetRules`? An organization-wide actor can grant any
   * scope. Otherwise only narrower, concrete grants are allowed: `own`, or explicit units /
   * resources that already lie inside the actor's own resolved scope. Relative scopes ("your
   * department", "assigned") would resolve against the *recipient's* units, which may be places
   * the actor can't reach, so a scoped actor can't grant them.
   */
  async covers(actor: Grants, code: string, targetRules: ScopeRule[]): Promise<boolean> {
    if (actor.level !== 'organization' || actor.all) return true;
    const actorScope = await this.accessScope(actor, code);
    if (actorScope.organizationWide) return true;
    const organizationId = actor.organizationId;
    if (!organizationId) return false;
    const def = getPermissionDefinition(code);
    for (const rule of targetRules) {
      const unitType = UNIT_SCOPE_TYPES[rule.type];
      if (rule.type === 'own') continue;
      if (unitType && rule.resourceIds.length) {
        const expanded = await this.expandUnits(organizationId, rule.resourceIds, unitType);
        if ([...expanded].every((u) => actorScope.unitIds.has(u)) && expanded.size > 0) continue;
        return false;
      }
      if (rule.type === 'custom' && def?.scopedResource) {
        for (const id of rule.resourceIds) {
          const attrs = await this.resolve(def.scopedResource, organizationId, id);
          if (!attrs || !this.inScope(actorScope, attrs, actor.subject?.userId)) return false;
        }
        continue;
      }
      return false;
    }
    return true;
  },
};
