import { Types, type ClientSession } from 'mongoose';
import { RoleModel, SCHOOL_ADMIN_ROLE_CODE, type Role } from './role.model.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { paginated, type Pagination } from '../../common/utils/pagination.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { auditService } from '../audit/audit.service.js';
import { permissionService } from '../permissions/permission.service.js';
import { getPermissionDefinition } from '../permissions/permission.catalog.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { PlatformMembershipModel } from '../platform/platform-membership.model.js';
import { UserModel, toPublicUser } from '../users/user.model.js';
import { authorizationService, grantedCodes, type Grants } from '../authorization/authorization.service.js';
import { assertCovers } from '../authorization/escalation.js';
import { scopeService } from '../authorization/scope.service.js';
import type { ScopeRule } from '../authorization/scope.types.js';

/** Which role namespace an operation works in. */
export type RoleScope = { level: 'organization'; organizationId: string } | { level: 'platform' };

export interface RoleActor {
  actorId: string;
  grants: Grants;
  meta: RequestMeta;
}

/** A permission reference (ID or code), optionally with scopes; a bare reference means organization-wide. */
export type PermissionEntry = string | { permission: string; scopes?: { type: string; resourceIds?: string[] }[] };

export interface RoleInput {
  name: string;
  code?: string;
  description?: string;
  level?: number;
  permissions?: PermissionEntry[];
}

type GrantRow = { permissionId: Types.ObjectId; code: string; scopes: ScopeRule[] };

/** Resolves entries against the catalog and validates their scopes for this namespace. */
async function buildGrants(scope: RoleScope, entries: PermissionEntry[]): Promise<{ rows: GrantRow[]; rules: Map<string, ScopeRule[]> }> {
  const refs = entries.map((e) => (typeof e === 'string' ? e : e.permission));
  const resolved = await permissionService.resolve(scope.level, refs);
  const byRef = new Map<string, { permissionId: Types.ObjectId; code: string }>();
  for (const p of resolved) {
    byRef.set(p.code, p);
    byRef.set(String(p.permissionId), p);
  }
  const rows = new Map<string, GrantRow>();
  for (const entry of entries) {
    const p = byRef.get(typeof entry === 'string' ? entry : entry.permission)!;
    let scopes: ScopeRule[] = [{ type: scope.level, resourceIds: [] }];
    if (typeof entry !== 'string' && entry.scopes) {
      if (scope.level === 'platform') throw ApiError.badRequest('Platform roles are always platform-wide and take no scopes.');
      scopes = await scopeService.validateRules(scope.organizationId, p.code, entry.scopes);
    }
    rows.set(p.code, { ...p, scopes });
  }
  return { rows: [...rows.values()], rules: new Map([...rows.values()].map((r) => [r.code, r.scopes])) };
}

const rulesOf = (role: { permissions: { code: string; scopes: { type: string; resourceIds?: unknown[] | null }[] }[] }) =>
  new Map(
    role.permissions.map((p) => [
      p.code,
      (p.scopes?.length ? p.scopes : [{ type: 'organization', resourceIds: [] }]).map((s) => ({
        type: s.type as ScopeRule['type'],
        resourceIds: (s.resourceIds ?? []).map(String),
      })),
    ]),
  );

/** Codes that would read as built-in authority. Names never grant privilege, but don't invite confusion. */
const RESERVED_CODES = new Set([SCHOOL_ADMIN_ROLE_CODE, 'super_admin', 'superadmin', 'platform_admin', 'admin', 'root']);

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'role';

const scopeFilter = (scope: RoleScope): Record<string, unknown> =>
  scope.level === 'organization'
    ? { type: 'organization', organizationId: new Types.ObjectId(scope.organizationId) }
    : { type: 'platform', organizationId: null };

/** Structural shape shared by hydrated and lean roles. */
type RoleLike = Omit<Role, 'permissions'> & {
  _id: unknown;
  permissions: { permissionId: unknown; code: string; scopes: { type: string; resourceIds?: unknown[] | null }[] }[];
};

function toPublicRole(role: RoleLike, extra: { userCount?: number } = {}) {
  const implicitAll = role.isSystem && role.code === SCHOOL_ADMIN_ROLE_CODE;
  return {
    id: String(role._id),
    name: role.name,
    code: role.code,
    description: role.description ?? null,
    type: role.type,
    organizationId: role.organizationId ? String(role.organizationId) : null,
    level: role.level,
    isSystem: role.isSystem,
    isProtected: role.isProtected,
    status: role.status,
    /** true → grants every permission of its level, including future ones. */
    allPermissions: implicitAll,
    permissions: role.permissions.map((p) => ({
      id: String(p.permissionId),
      code: p.code,
      name: getPermissionDefinition(p.code)?.name ?? p.code,
      scopes: p.scopes.map((s) => ({ type: s.type, resourceIds: (s.resourceIds ?? []).map(String) })),
    })),
    ...extra,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}


async function holderCount(scope: RoleScope, roleId: Types.ObjectId | string): Promise<number> {
  return scope.level === 'organization'
    ? MembershipModel.countDocuments({ organizationId: scope.organizationId, roles: roleId, status: { $ne: 'revoked' } })
    : PlatformMembershipModel.countDocuments({ roles: roleId });
}

export const roleService = {
  /** Creates the organization's protected system roles. Idempotent. */
  async ensureSystemRoles(organizationId: Types.ObjectId | string, createdBy: string, session?: ClientSession) {
    await RoleModel.updateOne(
      { organizationId, code: SCHOOL_ADMIN_ROLE_CODE },
      {
        $setOnInsert: {
          name: 'School Admin',
          code: SCHOOL_ADMIN_ROLE_CODE,
          description: 'Full administration of the school. Holds every school permission. Protected system role.',
          type: 'organization',
          organizationId,
          level: 1,
          isSystem: true,
          isProtected: true,
          permissions: [],
          status: 'active',
          createdBy,
        },
      },
      { upsert: true, session },
    );
  },

  async getSchoolAdminRoleId(organizationId: string, session?: ClientSession): Promise<string | null> {
    const role = await RoleModel.findOne({ organizationId, code: SCHOOL_ADMIN_ROLE_CODE }, { _id: 1 })
      .session(session ?? null)
      .lean();
    return role ? String(role._id) : null;
  },

  /**
   * Ensures every role ID is an active role of *this* organization. Platform roles and other
   * tenants' roles are rejected (FRD §8.4: a school must not assign platform-level roles).
   */
  async assertAssignable(organizationId: string, roleIds: string[], session?: ClientSession): Promise<Types.ObjectId[]> {
    return this.assertAssignableIn({ level: 'organization', organizationId }, roleIds, session);
  },

  async assertAssignableIn(scope: RoleScope, roleIds: string[], session?: ClientSession): Promise<Types.ObjectId[]> {
    const unique = [...new Set(roleIds.map(String))];
    if (unique.length === 0) return [];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw ApiError.badRequest('Invalid role id.');
    const found = await RoleModel.find({ _id: { $in: unique }, ...scopeFilter(scope), status: 'active' }, { _id: 1 })
      .session(session ?? null)
      .lean();
    if (found.length !== unique.length) {
      throw ApiError.badRequest(`One or more roles are invalid for this ${scope.level}.`, { roleIds: unique });
    }
    return found.map((r) => r._id);
  },

  async findInScope(scope: RoleScope, id: string) {
    const role = Types.ObjectId.isValid(id) ? await RoleModel.findOne({ _id: id, ...scopeFilter(scope) }) : null;
    if (!role) throw ApiError.notFound('Role not found');
    return role;
  },

  /** Grants conferred by one role (used for escalation checks). */
  async grantsOf(scope: RoleScope, roleIds: (string | Types.ObjectId)[]): Promise<Grants> {
    return authorizationService.rolesGrants(scope.level, roleIds, scope.level === 'organization' ? scope.organizationId : undefined);
  },

  async list(scope: RoleScope, filter: { status?: 'active' | 'inactive' } = {}) {
    const roles = await RoleModel.find({ ...scopeFilter(scope), ...(filter.status && { status: filter.status }) })
      .sort({ level: 1, name: 1 })
      .lean();
    const counts = await Promise.all(roles.map((r) => holderCount(scope, r._id)));
    return roles.map((r, i) => toPublicRole(r, { userCount: counts[i] }));
  },

  async get(scope: RoleScope, id: string) {
    const role = await this.findInScope(scope, id);
    return toPublicRole(role.toObject(), { userCount: await holderCount(scope, role._id) });
  },

  async create(scope: RoleScope, actor: RoleActor, input: RoleInput) {
    const code = input.code ?? slugify(input.name);
    if (RESERVED_CODES.has(code)) throw ApiError.badRequest(`"${code}" is a reserved role code.`);
    const { rows, rules } = await buildGrants(scope, input.permissions ?? []);
    await assertCovers(actor.grants, rows.map((p) => p.code), 'create this role', rules);

    const role = await RoleModel.create({
      name: input.name,
      code,
      description: input.description,
      type: scope.level,
      ...(scope.level === 'organization' && { organizationId: scope.organizationId }),
      level: input.level ?? 100,
      isSystem: false,
      isProtected: false,
      permissions: rows,
      status: 'active',
      createdBy: actor.actorId,
    });
    await this.audit(scope, actor, 'role.created', String(role._id), { after: { code, permissions: rows.map((p) => p.code) } });
    return toPublicRole(role.toObject(), { userCount: 0 });
  },

  /** Loads a role an actor intends to change: it must not be protected, and the actor must cover it. */
  async loadMutable(scope: RoleScope, actor: RoleActor, id: string, what: string) {
    const role = await this.findInScope(scope, id);
    if (role.isProtected || role.isSystem) {
      throw new ApiError('ROLE_PROTECTED', 'System roles cannot be modified.');
    }
    await assertCovers(actor.grants, role.permissions.map((p) => p.code), what, rulesOf(role));
    return role;
  },

  async update(scope: RoleScope, actor: RoleActor, id: string, input: Partial<RoleInput>) {
    const role = await this.loadMutable(scope, actor, id, 'edit this role');
    const before = { name: role.name, level: role.level, permissions: role.permissions.map((p) => p.code) };
    if (input.name !== undefined) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    if (input.level !== undefined) role.level = input.level;
    if (input.permissions !== undefined) {
      const { rows, rules } = await buildGrants(scope, input.permissions);
      await assertCovers(actor.grants, rows.map((p) => p.code), 'grant these permissions', rules);
      role.set('permissions', rows);
    }
    await role.save();
    await this.audit(scope, actor, 'role.updated', id, {
      before,
      after: { name: role.name, level: role.level, permissions: role.permissions.map((p) => p.code) },
    });
    return this.get(scope, id);
  },

  async setStatus(scope: RoleScope, actor: RoleActor, id: string, status: 'active' | 'inactive') {
    const role = await this.loadMutable(scope, actor, id, `${status === 'active' ? 'activate' : 'deactivate'} this role`);
    const before = role.status;
    role.status = status;
    await role.save();
    await this.audit(scope, actor, 'role.status_changed', id, { before: { status: before }, after: { status } });
    return this.get(scope, id);
  },

  /** FRD §8.3: only roles nobody holds (including pending invitations) can be deleted. */
  async remove(scope: RoleScope, actor: RoleActor, id: string) {
    const role = await this.loadMutable(scope, actor, id, 'delete this role');
    const holders = await holderCount(scope, role._id);
    if (holders > 0) throw ApiError.conflict(`This role is held by ${holders} user(s). Remove it from them first.`);
    await role.deleteOne();
    await this.audit(scope, actor, 'role.deleted', id, { before: { code: role.code, permissions: role.permissions.map((p) => p.code) } });
  },

  async addPermissions(scope: RoleScope, actor: RoleActor, id: string, refs: PermissionEntry[]) {
    const role = await this.loadMutable(scope, actor, id, 'edit this role');
    const { rows, rules } = await buildGrants(scope, refs);
    await assertCovers(actor.grants, rows.map((p) => p.code), 'grant these permissions', rules);
    const have = new Set(role.permissions.map((p) => p.code));
    const added = rows.filter((p) => !have.has(p.code));
    if (added.length) {
      role.permissions.push(...added);
      await role.save();
      await this.audit(scope, actor, 'role.permissions_added', id, { after: { permissions: added.map((p) => p.code) } });
    }
    return this.get(scope, id);
  },

  async removePermission(scope: RoleScope, actor: RoleActor, id: string, permissionRef: string) {
    const role = await this.loadMutable(scope, actor, id, 'edit this role');
    const entry = role.permissions.find((p) => String(p.permissionId) === permissionRef || p.code === permissionRef);
    if (!entry) throw ApiError.notFound('This role does not have that permission.');
    role.set('permissions', role.permissions.filter((p) => p !== entry));
    await role.save();
    await this.audit(scope, actor, 'role.permission_removed', id, { before: { permission: entry.code } });
    return this.get(scope, id);
  },

  /** Copies a role's permissions into a new custom role. Cloning School Admin copies today's full catalog. */
  async clone(scope: RoleScope, actor: RoleActor, id: string, input: { name: string; code?: string; description?: string }) {
    const source = await this.findInScope(scope, id);
    const sourceGrants = await this.grantsOf(scope, [source._id]);
    await assertCovers(actor.grants, sourceGrants, 'clone this role');
    return this.create(scope, actor, {
      name: input.name,
      code: input.code,
      description: input.description ?? source.description ?? undefined,
      level: Math.max(source.level, 2),
      // Keep the source's scopes; School Admin's implicit grants clone as organization-wide.
      permissions: sourceGrants.all
        ? grantedCodes(sourceGrants)
        : source.permissions.map((p) => ({ permission: p.code, scopes: rulesOf(source).get(p.code) })),
    });
  },

  /**
   * PUT /roles/:id/scopes (FRD §10.3 scope builder). Replaces the scopes of the listed
   * permissions, which must already be on the role. Same escalation rules as granting.
   */
  async setScopes(scope: RoleScope, actor: RoleActor, id: string, entries: { permission: string; scopes: { type: string; resourceIds?: string[] }[] }[]) {
    if (scope.level !== 'organization') throw ApiError.badRequest('Platform roles are always platform-wide.');
    const role = await this.loadMutable(scope, actor, id, 'edit this role');
    const { rows, rules } = await buildGrants(scope, entries);
    const onRole = new Set(role.permissions.map((p) => p.code));
    const missing = rows.filter((r) => !onRole.has(r.code)).map((r) => r.code);
    if (missing.length) throw ApiError.badRequest('Add these permissions to the role before scoping them.', { permissions: missing });
    await assertCovers(actor.grants, rows.map((r) => r.code), 'grant these scopes', rules);

    const before = Object.fromEntries([...rulesOf(role)].filter(([c]) => rules.has(c)));
    role.set(
      'permissions',
      role.permissions.map((p) => (rules.has(p.code) ? { permissionId: p.permissionId, code: p.code, scopes: rules.get(p.code) } : p)),
    );
    await role.save();
    await this.audit(scope, actor, 'role.scopes_updated', id, { before, after: Object.fromEntries(rules) });
    return this.scopes(scope, id);
  },

  async holders(scope: RoleScope, id: string, query: Pagination) {
    const role = await this.findInScope(scope, id);
    const skip = (query.page - 1) * query.limit;
    let rows: { userId: Types.ObjectId; status: string }[];
    let total: number;
    if (scope.level === 'organization') {
      const filter: Record<string, unknown> = { organizationId: scope.organizationId, roles: role._id, status: { $ne: 'revoked' } };
      [rows, total] = await Promise.all([
        MembershipModel.find(filter, { userId: 1, status: 1 }).skip(skip).limit(query.limit).lean<{ userId: Types.ObjectId; status: string }[]>(),
        MembershipModel.countDocuments(filter),
      ]);
    } else {
      const filter: Record<string, unknown> = { roles: role._id };
      [rows, total] = await Promise.all([
        PlatformMembershipModel.find(filter, { userId: 1, status: 1 }).skip(skip).limit(query.limit).lean<{ userId: Types.ObjectId; status: string }[]>(),
        PlatformMembershipModel.countDocuments(filter),
      ]);
    }
    const users = await UserModel.find({ _id: { $in: rows.map((r) => r.userId) } }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const items = rows.flatMap((r) => {
      const u = byId.get(String(r.userId));
      return u ? [{ ...toPublicUser(u), membershipStatus: r.status }] : [];
    });
    return paginated(items, total, query);
  },

  async scopes(scope: RoleScope, id: string) {
    const role = await this.get(scope, id);
    return { roleId: role.id, allPermissions: role.allPermissions, permissions: role.permissions };
  },

  async audit(
    scope: RoleScope,
    actor: RoleActor,
    action: string,
    roleId: string,
    data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    await auditService.record({
      actorId: actor.actorId,
      ...(scope.level === 'organization' && { organizationId: scope.organizationId }),
      action: scope.level === 'platform' ? `platform.${action}` : action,
      resource: 'role',
      resourceId: roleId,
      result: 'success',
      ...data,
      meta: actor.meta,
    });
  },
};
