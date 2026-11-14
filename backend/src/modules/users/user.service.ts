import { Types, type PipelineStage } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { escapeRegex, paginated, type Pagination } from '../../common/utils/pagination.js';
import { auditService } from '../audit/audit.service.js';
import { roleService } from '../roles/role.service.js';
import { platformAdminService } from '../platform/platform-admin.model.js';
import { MembershipModel, isMembershipUsable, toPublicMembership, type MembershipStatus } from '../memberships/membership.model.js';
import { assertMayManage, membershipService, type OrgActor } from '../memberships/membership.service.js';
import { authorizationService, grantedCodes } from '../authorization/authorization.service.js';
import { assertCovers, assertHas } from '../authorization/escalation.js';
import { getPermissionDefinition } from '../permissions/permission.catalog.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { OrganizationUnitModel } from '../organization-units/organization-unit.model.js';
import { InvitationModel, toPublicInvitation } from '../invitations/invitation.model.js';
import { invitationService } from '../invitations/invitation.service.js';
import { invitationDelivery } from '../invitations/invitation.delivery.js';
import { UserModel, toPublicUser } from './user.model.js';

export interface CreateOrgUserInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  roleIds?: string[];
  sendInvitation?: boolean;
  invitationExpiryDays?: number;
}

/**
 * Organization-scoped user management (FRD §6). A "user" here is a global identity seen through
 * its membership in the caller's organization; every lookup is filtered by organization, and an
 * identity without a membership in this organization is reported as not found.
 */
async function membershipForUser(organizationId: string, userId: string) {
  const membership = await MembershipModel.findOne({ organizationId, userId });
  if (!membership) throw ApiError.notFound('User not found');
  return membership;
}

export const userService = {
  async create(ctx: OrgActor, input: CreateOrgUserInput) {
    if (input.roleIds?.length) {
      assertHas(ctx.grants, 'roles.assign');
      const proposed = await roleService.assertAssignable(ctx.organizationId, input.roleIds);
      await assertCovers(ctx.grants, await authorizationService.rolesGrants('organization', proposed, ctx.organizationId), 'assign these roles');
    }
    const result = await inTransaction(async (session) => {
      const roleIds = await roleService.assertAssignable(ctx.organizationId, input.roleIds ?? [], session);
      const outcome = await invitationService.invite(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.actorId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          roleIds,
          expiresInDays: input.invitationExpiryDays,
          sendInvitation: input.sendInvitation,
        },
        session,
      );
      await auditService.record(
        {
          actorId: ctx.actorId,
          organizationId: ctx.organizationId,
          action: 'user.created',
          resource: 'user',
          resourceId: String(outcome.user._id),
          result: 'success',
          after: { membershipId: String(outcome.membership._id), roleIds: roleIds.map(String) },
          metadata: { identityCreated: outcome.userCreated, invitationQueued: !!outcome.invitation },
          meta: ctx.meta,
        },
        session,
      );
      return outcome;
    });
    if (result.invitation) invitationDelivery.trigger();
    return {
      // An existing identity may belong to other schools: don't reveal its profile to this one
      // until the person accepts. Show only the email the admin typed.
      user: result.userCreated
        ? toPublicUser(result.user.toObject())
        : { id: String(result.user._id), email: input.email.trim() },
      membership: toPublicMembership(result.membership.toObject()),
      invitation: result.invitation ? toPublicInvitation(result.invitation.toObject()) : null,
      existingIdentity: !result.userCreated,
    };
  },

  /** `scopeFilter` (from the caller's users.read scope) narrows the list; null = whole school. */
  async list(
    organizationId: string,
    query: Pagination & { search?: string; status?: MembershipStatus; roleId?: string; unitId?: string },
    scopeFilter: Record<string, unknown> | null = null,
  ) {
    const match: Record<string, unknown> = { organizationId: new Types.ObjectId(organizationId) };
    match.status = query.status ?? { $ne: 'revoked' };
    if (query.roleId) match.roles = new Types.ObjectId(query.roleId);
    if (query.unitId) {
      // Department filter (screen 2): members of the unit or anything beneath it.
      const units = await OrganizationUnitModel.find({ organizationId, $or: [{ _id: query.unitId }, { ancestors: query.unitId }] }, { _id: 1 }).lean();
      match.organizationUnitIds = { $in: units.map((u) => u._id) };
    }
    if (scopeFilter) match.$and = [scopeFilter];

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
    ];
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      pipeline.push({ $match: { $or: [{ 'user.firstName': rx }, { 'user.lastName': rx }, { 'user.email': rx }] } });
    }
    pipeline.push({
      $facet: {
        items: [{ $sort: { 'user.lastName': 1, 'user.firstName': 1 } }, { $skip: (query.page - 1) * query.limit }, { $limit: query.limit }],
        total: [{ $count: 'n' }],
      },
    });
    const [res] = await MembershipModel.aggregate(pipeline);
    const items = (res?.items ?? []).map(({ user, ...membership }: { user: Parameters<typeof toPublicUser>[0] } & Parameters<typeof toPublicMembership>[0]) => ({
      ...toPublicUser(user),
      membership: toPublicMembership(membership),
    }));
    return paginated(items, res?.total?.[0]?.n ?? 0, query);
  },

  async get(organizationId: string, userId: string) {
    const membership = await membershipForUser(organizationId, userId);
    const user = await UserModel.findById(userId).lean();
    if (!user) throw ApiError.notFound('User not found');
    return { ...toPublicUser(user), membership: toPublicMembership(membership.toObject()) };
  },

  /**
   * Profile edits change a global identity, which may also belong to other schools. A School Admin
   * may edit it only when this organization is the identity's sole (non-revoked) membership, and
   * never the Super Admin. Email is identity, not profile, and can't be changed here.
   */
  async update(ctx: OrgActor, userId: string, input: { firstName?: string; lastName?: string; phone?: string | null }) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    await platformAdminService.assertNotSuperAdmin(userId);
    if (userId !== ctx.actorId) await assertMayManage(membership, ctx, {});
    const elsewhere = await MembershipModel.exists({
      userId,
      organizationId: { $ne: ctx.organizationId },
      status: { $ne: 'revoked' },
    });
    if (elsewhere) {
      throw ApiError.forbidden('This user also belongs to another organization, so only they can edit their profile.');
    }
    const before = await UserModel.findById(userId).lean();
    const { phone, ...rest } = input;
    const update: Record<string, unknown> = { $set: rest };
    if (phone === null) update.$unset = { phone: 1 };
    else if (phone !== undefined) (update.$set as Record<string, unknown>).phone = phone;
    const user = await UserModel.findByIdAndUpdate(userId, update, { returnDocument: 'after', runValidators: true }).lean();
    await auditService.record({
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
      action: 'user.updated',
      resource: 'user',
      resourceId: userId,
      result: 'success',
      before: { firstName: before?.firstName, lastName: before?.lastName, phone: before?.phone },
      after: { firstName: user?.firstName, lastName: user?.lastName, phone: user?.phone },
      meta: ctx.meta,
    });
    return toPublicUser(user!);
  },

  /** DELETE /users/:id — removes the user from this organization; the global identity is kept. */
  async removeFromOrganization(ctx: OrgActor, userId: string) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    await membershipService.revoke(ctx, String(membership._id));
  },

  /** PATCH /users/:id/status — the user's status *in this organization* (their membership). */
  async setStatus(ctx: OrgActor, userId: string, status: MembershipStatus) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    return membershipService.changeStatus(ctx, String(membership._id), status);
  },

  /** Sends an invitation for an invited membership, or re-invites a revoked one. */
  async invite(ctx: OrgActor, userId: string, expiresInDays?: number) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    if (!['invited', 'revoked'].includes(membership.status)) throw ApiError.conflict('This user is already a member.');
    const user = await UserModel.findById(userId).lean();
    if (!user) throw ApiError.notFound('User not found');

    // Re-inviting restores the membership's previous roles, so the actor must be able to grant them.
    await assertCovers(ctx.grants, await authorizationService.rolesGrants('organization', membership.roles, ctx.organizationId), 'invite this user with their previous roles');
    const invitation = await inTransaction(async (session) => {
      const roleIds = await roleService.assertAssignable(ctx.organizationId, membership.roles.map(String), session);
      const { invitation } = await invitationService.invite(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.actorId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleIds,
          expiresInDays,
        },
        session,
      );
      await auditService.record(
        {
          actorId: ctx.actorId,
          organizationId: ctx.organizationId,
          action: 'invitation.created',
          resource: 'invitation',
          resourceId: String(invitation!._id),
          result: 'success',
          metadata: { userId },
          meta: ctx.meta,
        },
        session,
      );
      return invitation!;
    });
    invitationDelivery.trigger();
    return toPublicInvitation(invitation.toObject());
  },

  async resendInvitation(ctx: OrgActor, userId: string) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    const invitation = await InvitationModel.findOne({
      membershipId: membership._id,
      status: { $in: ['pending', 'expired'] },
    }).sort({ createdAt: -1 });
    if (!invitation) throw ApiError.conflict('This user has no pending invitation. Send a new one instead.');
    return invitationService.resend(ctx.organizationId, String(invitation._id), ctx.actorId, ctx.meta);
  },

  // ---------- Roles & effective permissions (FRD §12.4) ----------

  async roles(organizationId: string, userId: string) {
    const membership = await membershipForUser(organizationId, userId);
    const grants = await authorizationService.rolesGrants('organization', membership.roles, organizationId);
    return grants.roles;
  },

  /** Adds one role to the user's membership in this organization. */
  async assignRole(ctx: OrgActor, userId: string, roleId: string) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    if (membership.status === 'revoked') throw ApiError.conflict('This user is no longer a member.');
    await assertMayManage(membership, ctx, {});
    const [role] = await roleService.assertAssignable(ctx.organizationId, [roleId]);
    await assertCovers(ctx.grants, await authorizationService.rolesGrants('organization', [role!], ctx.organizationId), 'assign this role');
    if (!membership.roles.some((r) => String(r) === roleId)) {
      membership.roles.push(role!);
      await membership.save();
      await InvitationModel.updateMany({ membershipId: membership._id, status: 'pending' }, { $set: { proposedRoles: membership.roles } });
      await auditService.record({
        actorId: ctx.actorId,
        organizationId: ctx.organizationId,
        action: 'membership.role_assigned',
        resource: 'membership',
        resourceId: String(membership._id),
        result: 'success',
        after: { roleId },
        metadata: { userId },
        meta: ctx.meta,
      });
    }
    return this.roles(ctx.organizationId, userId);
  },

  async removeRole(ctx: OrgActor, userId: string, roleId: string) {
    const membership = await membershipForUser(ctx.organizationId, userId);
    if (!membership.roles.some((r) => String(r) === roleId)) throw ApiError.notFound('This user does not have that role.');
    const adminRoleId = await roleService.getSchoolAdminRoleId(ctx.organizationId);
    await assertMayManage(membership, ctx, { removesAdminRole: roleId === adminRoleId });
    await assertCovers(ctx.grants, await authorizationService.rolesGrants('organization', [roleId], ctx.organizationId), 'remove this role');
    membership.roles = membership.roles.filter((r) => String(r) !== roleId);
    await membership.save();
    await InvitationModel.updateMany({ membershipId: membership._id, status: 'pending' }, { $set: { proposedRoles: membership.roles } });
    await auditService.record({
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
      action: 'membership.role_removed',
      resource: 'membership',
      resourceId: String(membership._id),
      result: 'success',
      before: { roleId },
      metadata: { userId },
      meta: ctx.meta,
    });
    return this.roles(ctx.organizationId, userId);
  },

  /**
   * Effective permissions in this organization. Reflects what the user could do if their membership
   * is active; `effective` is false when membership or organization status blocks everything.
   */
  async permissions(organizationId: string, userId: string) {
    const membership = await membershipForUser(organizationId, userId);
    const grants = await authorizationService.rolesGrants('organization', membership.roles, organizationId);
    const org = await OrganizationModel.findById(organizationId, { status: 1 }).lean();
    return {
      effective: isMembershipUsable(membership) && org?.status === 'active',
      membershipStatus: membership.status,
      allPermissions: grants.all,
      roles: grants.roles,
      permissions: grantedCodes(grants).map((code) => ({ code, name: getPermissionDefinition(code)!.name, scope: 'organization' })),
    };
  },

  /** Within an organization only this organization's membership is visible (no cross-tenant leakage). */
  async memberships(organizationId: string, userId: string) {
    const membership = await membershipForUser(organizationId, userId);
    return [toPublicMembership(membership.toObject())];
  },
};
