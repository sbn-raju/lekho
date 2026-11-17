import { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { paginated, type Pagination } from '../../common/utils/pagination.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { auditService } from '../audit/audit.service.js';
import { roleService } from '../roles/role.service.js';
import { RoleModel } from '../roles/role.model.js';
import { UserModel } from '../users/user.model.js';
import { OrganizationModel, toPublicOrganization } from '../organizations/organization.model.js';
import { InvitationModel } from '../invitations/invitation.model.js';
import { sessionService } from '../sessions/session.service.js';
import { authorizationService, type Grants } from '../authorization/authorization.service.js';
import { assertCovers, assertHas } from '../authorization/escalation.js';
import {
  MEMBERSHIP_STATUS_TRANSITIONS,
  MembershipModel,
  isMembershipUsable,
  toPublicMembership,
  type MembershipDocument,
  type MembershipStatus,
} from './membership.model.js';

export interface OrgActor {
  organizationId: string;
  actorId: string;
  /** The actor's organization grants, for privilege-escalation checks. */
  grants: Grants;
  meta: RequestMeta;
}

/**
 * Guards applied to any change to someone's membership:
 *  - no changes to your own membership (prevents self-elevation and self-lockout);
 *  - you must hold every permission the target holds (can't act on someone more privileged);
 *  - the initial School Admin (FRD §8.4) can't be suspended, revoked or lose the School Admin role.
 */
export async function assertMayManage(
  membership: MembershipDocument,
  ctx: OrgActor,
  change: { removesAdminRole?: boolean; statusChange?: boolean },
) {
  if (String(membership.userId) === ctx.actorId) {
    throw ApiError.forbidden('You cannot change your own membership.');
  }
  const targetGrants = await authorizationService.rolesGrants('organization', membership.roles, ctx.organizationId);
  await assertCovers(ctx.grants, targetGrants, 'manage this member');
  const org = await OrganizationModel.findById(ctx.organizationId, { primaryAdminUserId: 1 }).lean();
  const isPrimary = org?.primaryAdminUserId && String(org.primaryAdminUserId) === String(membership.userId);
  if (isPrimary && (change.statusChange || change.removesAdminRole)) {
    throw new ApiError('ROLE_PROTECTED', 'The initial School Admin is protected. Contact Lekho support to change it.');
  }
}

export const membershipService = {
  async findInOrg(organizationId: string, membershipId: string, session?: ClientSession) {
    const m = await MembershipModel.findOne({ _id: membershipId, organizationId }).session(session ?? null);
    if (!m) throw ApiError.notFound('Membership not found');
    return m;
  },

  async list(
    organizationId: string,
    query: Pagination & { status?: MembershipStatus; roleId?: string; userId?: string },
    scopeFilter: Record<string, unknown> | null = null,
  ) {
    const filter: Record<string, unknown> = { organizationId };
    if (scopeFilter) filter.$and = [scopeFilter];
    if (query.status) filter.status = query.status;
    if (query.roleId) filter.roles = new Types.ObjectId(query.roleId);
    if (query.userId) filter.userId = query.userId;
    const [items, total] = await Promise.all([
      MembershipModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      MembershipModel.countDocuments(filter),
    ]);
    return paginated(items.map(toPublicMembership), total, query);
  },

  /** Platform view of a school's members: memberships plus basic profile. */
  async listWithUsers(organizationId: string, query: Pagination & { status?: MembershipStatus; roleId?: string; userId?: string }) {
    const page = await this.list(organizationId, query);
    const users = await UserModel.find({ _id: { $in: page.items.map((m) => m.userId) } }, { firstName: 1, lastName: 1, email: 1, status: 1 }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const roles = await RoleModel.find({ _id: { $in: page.items.flatMap((m) => m.roleIds) } }, { name: 1 }).lean();
    const roleName = new Map(roles.map((r) => [String(r._id), r.name]));
    return {
      ...page,
      items: page.items.map((m) => {
        const u = byId.get(m.userId);
        return {
          ...m,
          user: u ? { id: m.userId, firstName: u.firstName, lastName: u.lastName, email: u.email, status: u.status } : null,
          roles: m.roleIds.map((id) => ({ id, name: roleName.get(id) ?? 'Unknown role' })),
        };
      }),
    };
  },

  async get(organizationId: string, membershipId: string) {
    return toPublicMembership((await this.findInOrg(organizationId, membershipId)).toObject());
  },

  async update(ctx: OrgActor, membershipId: string, input: { roleIds?: string[]; expiresAt?: Date | null }) {
    const membership = await this.findInOrg(ctx.organizationId, membershipId);
    if (membership.status === 'revoked') throw ApiError.conflict('Revoked memberships cannot be changed. Invite the user again.');

    const before = toPublicMembership(membership.toObject());
    if (input.roleIds) {
      assertHas(ctx.grants, 'roles.assign');
      const roles = await roleService.assertAssignable(ctx.organizationId, input.roleIds);
      const adminRoleId = await roleService.getSchoolAdminRoleId(ctx.organizationId);
      const hadAdmin = membership.roles.some((r) => String(r) === adminRoleId);
      const keepsAdmin = roles.some((r) => String(r) === adminRoleId);
      await assertMayManage(membership, ctx, { removesAdminRole: hadAdmin && !keepsAdmin });
      // Every role being added or removed must be within the actor's own permissions.
      const current = new Set(membership.roles.map(String));
      const next = new Set(roles.map(String));
      const changed = [...current].filter((r) => !next.has(r)).concat([...next].filter((r) => !current.has(r)));
      await assertCovers(ctx.grants, await authorizationService.rolesGrants('organization', changed, ctx.organizationId), 'assign or remove these roles');
      membership.roles = roles;
      // An invited user receives the updated roles on acceptance.
      if (membership.status === 'invited') {
        await InvitationModel.updateMany({ membershipId: membership._id, status: 'pending' }, { $set: { proposedRoles: roles } });
      }
    } else {
      await assertMayManage(membership, ctx, {});
    }
    if (input.expiresAt !== undefined) {
      if (input.expiresAt && input.expiresAt <= new Date()) throw ApiError.badRequest('expiresAt must be in the future.');
      membership.expiresAt = input.expiresAt ?? undefined;
    }
    await membership.save();
    const after = toPublicMembership(membership.toObject());
    await auditService.record({
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
      action: 'membership.updated',
      resource: 'membership',
      resourceId: membershipId,
      result: 'success',
      before: { roleIds: before.roleIds, expiresAt: before.expiresAt },
      after: { roleIds: after.roleIds, expiresAt: after.expiresAt },
      meta: ctx.meta,
    });
    return after;
  },

  async changeStatus(ctx: OrgActor, membershipId: string, status: MembershipStatus) {
    const membership = await this.findInOrg(ctx.organizationId, membershipId);
    const from = membership.status;
    if (from === status) return toPublicMembership(membership.toObject());
    if (!MEMBERSHIP_STATUS_TRANSITIONS[from].includes(status)) {
      throw ApiError.conflict(`Cannot change membership status from ${from} to ${status}.`);
    }
    await assertMayManage(membership, ctx, { statusChange: true });
    membership.status = status;
    await membership.save();
    await auditService.record({
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
      action: 'membership.status_changed',
      resource: 'membership',
      resourceId: membershipId,
      result: 'success',
      before: { status: from },
      after: { status },
      meta: ctx.meta,
    });
    return toPublicMembership(membership.toObject());
  },

  /**
   * Removes the user from this organization only (FRD §6.4 rules 5–6): the global identity and
   * memberships elsewhere are untouched. Pending invitations for the membership are revoked.
   */
  async revoke(ctx: OrgActor, membershipId: string) {
    await inTransaction(async (session) => {
      const membership = await this.findInOrg(ctx.organizationId, membershipId, session);
      if (membership.status === 'revoked') return;
      await assertMayManage(membership, ctx, { statusChange: true });
      const before = membership.status;
      const now = new Date();
      membership.status = 'revoked';
      membership.revokedAt = now;
      await membership.save({ session });
      await InvitationModel.updateMany(
        { membershipId: membership._id, status: 'pending' },
        { $set: { status: 'revoked', revokedAt: now } },
        { session },
      );
      await auditService.record(
        {
          actorId: ctx.actorId,
          organizationId: ctx.organizationId,
          action: 'membership.revoked',
          resource: 'membership',
          resourceId: membershipId,
          result: 'success',
          before: { status: before },
          after: { status: 'revoked' },
          metadata: { userId: String(membership.userId) },
          meta: ctx.meta,
        },
        session,
      );
    });
  },

  // ---------- Current user ----------

  /** Organizations the caller belongs to (any status but revoked), for the school switcher. */
  async listMine(userId: string) {
    const memberships = await MembershipModel.find({ userId, status: { $ne: 'revoked' } }).sort({ createdAt: 1 }).lean();
    const orgIds = memberships.map((m) => m.organizationId);
    const roleIds = memberships.flatMap((m) => m.roles);
    const [orgs, roles] = await Promise.all([
      OrganizationModel.find({ _id: { $in: orgIds } }).lean(),
      RoleModel.find({ _id: { $in: roleIds } }, { name: 1, code: 1 }).lean(),
    ]);
    const orgById = new Map(orgs.map((o) => [String(o._id), o]));
    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    return memberships.flatMap((m) => {
      const org = orgById.get(String(m.organizationId));
      if (!org) return [];
      return [
        {
          ...toPublicMembership(m),
          usable: isMembershipUsable(m) && org.status === 'active',
          organization: { id: String(org._id), name: org.name, slug: org.slug, logo: org.logo ?? null, status: org.status },
          roles: m.roles.flatMap((r) => {
            const role = roleById.get(String(r));
            return role ? [{ id: String(role._id), name: role.name, code: role.code }] : [];
          }),
        },
      ];
    });
  },

  async setActiveOrganization(userId: string, sessionId: string, organizationId: string, meta: RequestMeta) {
    const [org, membership] = await Promise.all([
      OrganizationModel.findById(organizationId).lean(),
      MembershipModel.findOne({ userId, organizationId }).lean(),
    ]);
    if (!org || !membership) throw new ApiError('TENANT_MISMATCH', 'You are not a member of this organization.');
    if (!isMembershipUsable(membership)) throw new ApiError('MEMBERSHIP_INACTIVE', 'Your membership in this organization is not active.');
    if (org.status !== 'active') throw new ApiError('ORGANIZATION_INACTIVE', 'This organization is not active.');
    await sessionService.setActiveOrganization(sessionId, organizationId);
    await auditService.record({
      actorId: userId,
      organizationId,
      action: 'session.organization_selected',
      resource: 'session',
      resourceId: sessionId,
      result: 'success',
      meta,
    });
    return { organization: toPublicOrganization(org), membership: toPublicMembership(membership) };
  },
};
