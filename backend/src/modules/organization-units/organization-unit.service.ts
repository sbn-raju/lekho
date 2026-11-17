import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { paginated, type Pagination } from '../../common/utils/pagination.js';
import { auditService } from '../audit/audit.service.js';
import { MembershipModel, toPublicMembership } from '../memberships/membership.model.js';
import { assertMayManage, type OrgActor } from '../memberships/membership.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { RoleModel } from '../roles/role.model.js';
import { UserModel, toPublicUser } from '../users/user.model.js';
import { authorizationService } from '../authorization/authorization.service.js';
import { scopeService } from '../authorization/scope.service.js';
import {
  DEFAULT_HIERARCHY_MAX_DEPTH,
  OrganizationUnitModel,
  toPublicUnit,
  type OrganizationUnit,
  type OrganizationUnitType,
} from './organization-unit.model.js';

type UnitDoc = OrganizationUnit & { _id: Types.ObjectId };

export interface UnitInput {
  name: string;
  code: string;
  type: OrganizationUnitType;
  parentId?: string | null;
  description?: string;
}

const RELATIVE = new Set(['department', 'class', 'section', 'assigned']);

/** Structural rules: sections live directly under classes; nothing lives under a section. */
function assertPlacement(type: OrganizationUnitType, parent: UnitDoc | null) {
  if (type === 'section' && parent?.type !== 'class') throw ApiError.badRequest('A section must be placed directly under a class.');
  if (parent?.type === 'section') throw ApiError.badRequest('Sections cannot contain other units.');
}

const MANAGED_MESSAGE: Record<string, string> = {
  academics: 'This unit belongs to a class or section. Change it from Classes & sections instead.',
};

/** Units owned by another module can only be changed through that module. */
function assertNotManaged(unit: { managedBy?: string | null }) {
  if (unit.managedBy) {
    throw new ApiError('CONFLICT', MANAGED_MESSAGE[unit.managedBy] ?? 'This unit is managed by another module.', { reason: 'managed_unit', managedBy: unit.managedBy });
  }
}

async function maxDepth(organizationId: string): Promise<number> {
  const org = await OrganizationModel.findById(organizationId, { settings: 1 }).lean();
  return (org?.settings as { hierarchyMaxDepth?: number } | undefined)?.hierarchyMaxDepth ?? DEFAULT_HIERARCHY_MAX_DEPTH;
}

async function findUnit(organizationId: string, id: string) {
  const unit = Types.ObjectId.isValid(id) ? await OrganizationUnitModel.findOne({ _id: id, organizationId }) : null;
  if (!unit) throw ApiError.notFound('Organization unit not found');
  return unit;
}

/** Creating or moving to the top level isn't covered by any unit, so it needs organization-wide reach. */
async function assertOrgWide(ctx: OrgActor, code: string) {
  if (!(await scopeService.accessScope(ctx.grants, code)).organizationWide) {
    throw new ApiError('FORBIDDEN', 'Only organization-wide administrators can work at the top of the hierarchy.', {
      reason: 'out_of_scope',
      requiredPermission: code,
    });
  }
}

const audit = (ctx: OrgActor, action: string, unitId: string, data: { before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown> } = {}) =>
  auditService.record({
    actorId: ctx.actorId,
    organizationId: ctx.organizationId,
    action,
    resource: 'organization_unit',
    resourceId: unitId,
    result: 'success',
    ...data,
    meta: ctx.meta,
  });

/** Organizational hierarchy (FRD §11). Every operation is tenant-filtered and scope-checked. */
export const organizationUnitService = {
  async list(organizationId: string, filter: { type?: OrganizationUnitType; parentId?: string | null; status?: string }) {
    const q: Record<string, unknown> = { organizationId };
    if (filter.type) q.type = filter.type;
    if (filter.status) q.status = filter.status;
    if (filter.parentId !== undefined) q.parentId = filter.parentId === null ? null : filter.parentId;
    const units = await OrganizationUnitModel.find(q).sort({ depth: 1, name: 1 }).lean();
    return units.map((u) => toPublicUnit(u));
  },

  /** Whole hierarchy as a nested tree, with member counts. */
  async tree(organizationId: string) {
    const units = await OrganizationUnitModel.find({ organizationId }).sort({ name: 1 }).lean();
    const counts = await MembershipModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { organizationId: new Types.ObjectId(organizationId), status: { $ne: 'revoked' } } },
      { $unwind: '$organizationUnitIds' },
      { $group: { _id: '$organizationUnitIds', n: { $sum: 1 } } },
    ]);
    const countById = new Map(counts.map((c) => [String(c._id), c.n]));
    type Node = ReturnType<typeof toPublicUnit> & { memberCount: number; children: Node[] };
    const nodes = new Map<string, Node>(
      units.map((u) => [String(u._id), { ...toPublicUnit(u), memberCount: countById.get(String(u._id)) ?? 0, children: [] }]),
    );
    const roots: Node[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  },

  async get(organizationId: string, id: string) {
    const unit = await findUnit(organizationId, id);
    const [memberCount, childCount, heads] = await Promise.all([
      MembershipModel.countDocuments({ organizationId, organizationUnitIds: unit._id, status: { $ne: 'revoked' } }),
      OrganizationUnitModel.countDocuments({ organizationId, parentId: unit._id }),
      UserModel.find({ _id: { $in: unit.headUserIds } }, { firstName: 1, lastName: 1, email: 1 }).lean(),
    ]);
    return toPublicUnit(unit.toObject(), {
      memberCount,
      childCount,
      heads: heads.map((h) => ({ id: String(h._id), name: `${h.firstName} ${h.lastName}`, email: h.email })),
    });
  },

  async create(ctx: OrgActor, input: UnitInput) {
    let parent: UnitDoc | null = null;
    if (input.parentId) {
      await scopeService.assertResource(ctx.grants, 'organization_units.create', input.parentId, 'Parent unit not found');
      parent = (await findUnit(ctx.organizationId, input.parentId)).toObject() as UnitDoc;
      if (parent.status !== 'active') throw ApiError.badRequest('The parent unit is inactive.');
      assertNotManaged(parent);
    } else {
      await assertOrgWide(ctx, 'organization_units.create');
    }
    assertPlacement(input.type, parent);
    const depth = parent ? parent.depth + 1 : 1;
    const limit = await maxDepth(ctx.organizationId);
    if (depth > limit) throw ApiError.badRequest(`The hierarchy is limited to ${limit} levels.`);

    const unit = await OrganizationUnitModel.create({
      organizationId: ctx.organizationId,
      name: input.name,
      code: input.code,
      type: input.type,
      description: input.description,
      parentId: parent?._id,
      ancestors: parent ? [...parent.ancestors, parent._id] : [],
      depth,
      createdBy: ctx.actorId,
    });
    await audit(ctx, 'organization_unit.created', String(unit._id), { after: { name: unit.name, code: unit.code, type: unit.type, parentId: input.parentId ?? null } });
    return toPublicUnit(unit.toObject());
  },

  async update(ctx: OrgActor, id: string, input: { name?: string; code?: string; description?: string | null; status?: 'active' | 'inactive' }) {
    await scopeService.assertResource(ctx.grants, 'organization_units.update', id, 'Organization unit not found');
    const unit = await findUnit(ctx.organizationId, id);
    assertNotManaged(unit);
    const before = { name: unit.name, code: unit.code, status: unit.status };
    if (input.name !== undefined) unit.name = input.name;
    if (input.code !== undefined) unit.code = input.code;
    if (input.description !== undefined) unit.description = input.description ?? undefined;
    if (input.status !== undefined) unit.status = input.status;
    await unit.save();
    await audit(ctx, 'organization_unit.updated', id, { before, after: { name: unit.name, code: unit.code, status: unit.status } });
    return toPublicUnit(unit.toObject());
  },

  /** Re-parents a unit and its whole subtree, keeping the materialized paths consistent. */
  async move(ctx: OrgActor, id: string, newParentId: string | null) {
    await scopeService.assertResource(ctx.grants, 'organization_units.update', id, 'Organization unit not found');
    if (newParentId) await scopeService.assertResource(ctx.grants, 'organization_units.update', newParentId, 'Parent unit not found');
    else await assertOrgWide(ctx, 'organization_units.update');

    await inTransaction(async (session) => {
      const unit = await OrganizationUnitModel.findOne({ _id: id, organizationId: ctx.organizationId }).session(session);
      if (!unit) throw ApiError.notFound('Organization unit not found');
      assertNotManaged(unit);
      let parent: UnitDoc | null = null;
      if (newParentId) {
        parent = (await OrganizationUnitModel.findOne({ _id: newParentId, organizationId: ctx.organizationId }).session(session).lean()) as UnitDoc | null;
        if (!parent) throw ApiError.notFound('Parent unit not found');
        if (String(parent._id) === id || parent.ancestors.some((a) => String(a) === id)) {
          throw ApiError.badRequest('A unit cannot be moved inside itself.');
        }
        assertNotManaged(parent);
      }
      assertPlacement(unit.type, parent);

      const descendants = await OrganizationUnitModel.find({ organizationId: ctx.organizationId, ancestors: unit._id }).session(session);
      const prefix = parent ? [...parent.ancestors, parent._id] : [];
      const oldPrefixLength = unit.ancestors.length;
      const subtreeExtra = Math.max(0, ...descendants.map((d) => d.depth - unit.depth));
      const limit = await maxDepth(ctx.organizationId);
      if (prefix.length + 1 + subtreeExtra > limit) throw ApiError.badRequest(`The hierarchy is limited to ${limit} levels.`);

      const before = { parentId: unit.parentId ? String(unit.parentId) : null };
      unit.parentId = parent?._id;
      unit.set('ancestors', prefix);
      unit.depth = prefix.length + 1;
      await unit.save({ session });
      if (descendants.length) {
        await OrganizationUnitModel.bulkWrite(
          descendants.map((d) => {
            const ancestors = [...prefix, ...d.ancestors.slice(oldPrefixLength)];
            return { updateOne: { filter: { _id: d._id }, update: { $set: { ancestors, depth: ancestors.length + 1 } } } };
          }),
          { session },
        );
      }
      await auditService.record(
        {
          actorId: ctx.actorId,
          organizationId: ctx.organizationId,
          action: 'organization_unit.moved',
          resource: 'organization_unit',
          resourceId: id,
          result: 'success',
          before,
          after: { parentId: newParentId },
          metadata: { descendantsMoved: descendants.length },
          meta: ctx.meta,
        },
        session,
      );
    });
    return this.get(ctx.organizationId, id);
  },

  /** FRD §11: only empty units can be deleted (no children, no members, not used by role scopes). */
  async remove(ctx: OrgActor, id: string) {
    await scopeService.assertResource(ctx.grants, 'organization_units.delete', id, 'Organization unit not found');
    const unit = await findUnit(ctx.organizationId, id);
    assertNotManaged(unit);
    const [children, members, roles] = await Promise.all([
      OrganizationUnitModel.countDocuments({ organizationId: ctx.organizationId, parentId: unit._id }),
      MembershipModel.countDocuments({ organizationId: ctx.organizationId, organizationUnitIds: unit._id, status: { $ne: 'revoked' } }),
      RoleModel.countDocuments({ organizationId: ctx.organizationId, 'permissions.scopes.resourceIds': unit._id }),
    ]);
    if (children || members || roles) {
      throw ApiError.conflict('Only empty units can be deleted.', { childUnits: children, members, rolesReferencing: roles });
    }
    await unit.deleteOne();
    await audit(ctx, 'organization_unit.deleted', id, { before: { name: unit.name, code: unit.code, type: unit.type } });
  },

  async members(organizationId: string, id: string, query: Pagination & { includeDescendants?: boolean }, scopeFilter: Record<string, unknown> | null = null) {
    const unit = await findUnit(organizationId, id);
    const unitIds = query.includeDescendants
      ? [unit._id, ...(await OrganizationUnitModel.find({ organizationId, ancestors: unit._id }, { _id: 1 }).lean()).map((u) => u._id)]
      : [unit._id];
    const filter: Record<string, unknown> = { organizationId, organizationUnitIds: { $in: unitIds }, status: { $ne: 'revoked' } };
    if (scopeFilter) filter.$and = [scopeFilter];
    const [rows, total] = await Promise.all([
      MembershipModel.find(filter).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      MembershipModel.countDocuments(filter),
    ]);
    const users = new Map((await UserModel.find({ _id: { $in: rows.map((r) => r.userId) } }).lean()).map((u) => [String(u._id), u]));
    const heads = new Set(unit.headUserIds.map(String));
    const items = rows.flatMap((m) => {
      const u = users.get(String(m.userId));
      return u ? [{ ...toPublicUser(u), membership: toPublicMembership(m), isHead: heads.has(String(u._id)) }] : [];
    });
    return paginated(items, total, query);
  },

  /**
   * Adds a member to a unit (optionally as its head). Placing someone in a unit extends any
   * relative scopes they hold ("their department") to that unit, so for each such permission the
   * actor must already reach the unit with it. No changes to your own placement.
   */
  async addMember(ctx: OrgActor, unitId: string, input: { userId: string; head?: boolean }) {
    await scopeService.assertResource(ctx.grants, 'organization_units.assign', unitId, 'Organization unit not found');
    const unit = await findUnit(ctx.organizationId, unitId);
    if (unit.status !== 'active') throw ApiError.badRequest('This unit is inactive.');
    const membership = await MembershipModel.findOne({ organizationId: ctx.organizationId, userId: input.userId });
    if (!membership || membership.status === 'revoked') throw ApiError.notFound('Member not found');
    if (input.userId === ctx.actorId) throw ApiError.forbidden('You cannot change your own unit assignments.');
    await assertMayManage(membership, ctx, {});

    const targetGrants = await authorizationService.rolesGrants('organization', membership.roles, ctx.organizationId);
    const expanded = await scopeService.expandUnits(ctx.organizationId, [unitId]);
    const tooBroad: string[] = [];
    for (const [code, rules] of targetGrants.rules) {
      if (targetGrants.all || !rules.some((r) => RELATIVE.has(r.type) && r.resourceIds.length === 0)) continue;
      const actorScope = await scopeService.accessScope(ctx.grants, code);
      if (!actorScope.organizationWide && ![...expanded].every((u) => actorScope.unitIds.has(u))) tooBroad.push(code);
    }
    if (tooBroad.length) {
      throw new ApiError('FORBIDDEN', "Placing this person here would give them access you don't have.", {
        reason: 'privilege_escalation',
        scopeTooBroad: tooBroad,
      });
    }

    const already = membership.organizationUnitIds.some((u) => String(u) === unitId);
    if (!already) {
      membership.organizationUnitIds.push(unit._id);
      await membership.save();
    }
    const isHead = unit.headUserIds.some((h) => String(h) === input.userId);
    if (input.head !== undefined && input.head !== isHead) {
      unit.set('headUserIds', input.head ? [...unit.headUserIds, membership.userId] : unit.headUserIds.filter((h) => String(h) !== input.userId));
      await unit.save();
    }
    await audit(ctx, 'organization_unit.member_added', unitId, { after: { userId: input.userId, head: input.head ?? isHead } });
    return this.get(ctx.organizationId, unitId);
  },

  async removeMember(ctx: OrgActor, unitId: string, userId: string) {
    await scopeService.assertResource(ctx.grants, 'organization_units.assign', unitId, 'Organization unit not found');
    const unit = await findUnit(ctx.organizationId, unitId);
    if (userId === ctx.actorId) throw ApiError.forbidden('You cannot change your own unit assignments.');
    const membership = await MembershipModel.findOne({ organizationId: ctx.organizationId, userId });
    if (!membership || !membership.organizationUnitIds.some((u) => String(u) === unitId)) {
      throw ApiError.notFound('This person is not a member of the unit.');
    }
    await assertMayManage(membership, ctx, {});
    membership.set('organizationUnitIds', membership.organizationUnitIds.filter((u) => String(u) !== unitId));
    await membership.save();
    if (unit.headUserIds.some((h) => String(h) === userId)) {
      unit.set('headUserIds', unit.headUserIds.filter((h) => String(h) !== userId));
      await unit.save();
    }
    await audit(ctx, 'organization_unit.member_removed', unitId, { before: { userId } });
    return this.get(ctx.organizationId, unitId);
  },
};
