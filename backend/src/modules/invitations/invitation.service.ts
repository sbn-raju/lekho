import { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { normalizeEmail, sha256 } from '../../common/utils/crypto.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { paginated, type Pagination } from '../../common/utils/pagination.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { UserModel } from '../users/user.model.js';
import { CredentialModel } from '../users/credential.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { auditService } from '../audit/audit.service.js';
import { passwordService } from '../auth/password.service.js';
import { InvitationModel, toPublicInvitation, type InvitationDocument } from './invitation.model.js';
import { invitationDelivery } from './invitation.delivery.js';

export const DEFAULT_INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InviteInput {
  organizationId: string;
  actorId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  /** Already validated against the organization by the caller. */
  roleIds: Types.ObjectId[];
  expiresInDays?: number;
  purpose?: 'member' | 'initial_admin';
  /** false: create the user and invited membership but don't create/send an invitation yet. */
  sendInvitation?: boolean;
}

const INVALID_LINK = () => ApiError.badRequest('This invitation is invalid or has expired.');

/** Organization statuses in which invitations can be accepted. */
const ACCEPTING_ORG_STATUSES = ['onboarding', 'active'];

async function findUsableByToken(token: string, session?: ClientSession) {
  const invitation = await InvitationModel.findOne({ tokenHash: sha256(token) }).session(session ?? null);
  if (!invitation || invitation.status !== 'pending') throw INVALID_LINK();
  if (invitation.expiresAt <= new Date()) {
    await InvitationModel.updateOne({ _id: invitation._id, status: 'pending' }, { $set: { status: 'expired' } });
    throw INVALID_LINK();
  }
  return invitation;
}

export const invitationService = {
  /**
   * Find-or-create the global user, find-or-create an `invited` membership, supersede any pending
   * invitation for it, and queue a new invitation. Must run inside the caller's transaction.
   * Never modifies an existing user's profile: that identity may belong to other schools too.
   */
  async invite(input: InviteInput, session: ClientSession) {
    const normalizedEmail = normalizeEmail(input.email);
    let user = await UserModel.findOne({ normalizedEmail }).session(session);
    const userCreated = !user;
    if (!user) {
      [user] = await UserModel.create(
        [
          {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email.trim(),
            normalizedEmail,
            phone: input.phone,
            status: 'invited',
            emailVerified: false,
          },
        ],
        { session },
      );
    } else if (['deleted', 'suspended', 'locked'].includes(user.status)) {
      throw ApiError.conflict('This account cannot be invited. Contact Lekho support.');
    }
    const userId = user!._id;

    let membership = await MembershipModel.findOne({ userId, organizationId: input.organizationId }).session(session);
    if (membership && ['active', 'suspended', 'inactive'].includes(membership.status)) {
      throw ApiError.conflict('This user is already a member of the organization.');
    }
    if (membership) {
      membership.status = 'invited';
      membership.roles = input.roleIds;
      membership.invitedBy = new Types.ObjectId(input.actorId);
      membership.revokedAt = undefined;
      await membership.save({ session });
    } else {
      [membership] = await MembershipModel.create(
        [
          {
            userId,
            organizationId: input.organizationId,
            roles: input.roleIds,
            status: 'invited',
            invitedBy: input.actorId,
          },
        ],
        { session },
      );
    }

    let invitation: InvitationDocument | null = null;
    if (input.sendInvitation !== false) {
      invitation = await this.createForMembership(
        {
          organizationId: input.organizationId,
          userId: String(userId),
          membershipId: String(membership!._id),
          email: user!.email,
          actorId: input.actorId,
          roleIds: input.roleIds,
          expiresInDays: input.expiresInDays,
          purpose: input.purpose ?? 'member',
        },
        session,
      );
    }
    return { user: user!, membership: membership!, invitation, userCreated };
  },

  /** Supersedes pending invitations for the membership and queues a new one for delivery. */
  async createForMembership(
    input: {
      organizationId: string;
      userId: string;
      membershipId: string;
      email: string;
      actorId: string;
      roleIds: Types.ObjectId[];
      expiresInDays?: number;
      purpose: 'member' | 'initial_admin';
    },
    session: ClientSession,
  ): Promise<InvitationDocument> {
    const now = new Date();
    await InvitationModel.updateMany(
      { membershipId: input.membershipId, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: now } },
      { session },
    );
    const [invitation] = await InvitationModel.create(
      [
        {
          organizationId: input.organizationId,
          userId: input.userId,
          membershipId: input.membershipId,
          email: input.email,
          normalizedEmail: normalizeEmail(input.email),
          purpose: input.purpose,
          invitedBy: input.actorId,
          proposedRoles: input.roleIds,
          status: 'pending',
          expiresAt: new Date(now.getTime() + (input.expiresInDays ?? DEFAULT_INVITATION_DAYS) * DAY_MS),
          delivery: { status: 'queued', attempts: 0, nextAttemptAt: now },
        },
      ],
      { session },
    );
    return invitation!;
  },

  async list(organizationId: string, query: Pagination & { status?: string }) {
    const now = new Date();
    const filter: Record<string, unknown> = { organizationId };
    // "expired" includes pending invitations whose date has passed but haven't been swept yet.
    if (query.status === 'expired') filter.$or = [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }];
    else if (query.status === 'pending') Object.assign(filter, { status: 'pending', expiresAt: { $gt: now } });
    else if (query.status) filter.status = query.status;

    const [items, total] = await Promise.all([
      InvitationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      InvitationModel.countDocuments(filter),
    ]);
    return paginated(items.map(toPublicInvitation), total, query);
  },

  async getInOrg(organizationId: string, invitationId: string) {
    const invitation = await InvitationModel.findOne({ _id: invitationId, organizationId });
    if (!invitation) throw ApiError.notFound('Invitation not found');
    return invitation;
  },

  /** Re-queues delivery with a fresh token and a renewed expiry. Works for pending or expired invitations. */
  async resend(organizationId: string, invitationId: string, actorId: string, meta: RequestMeta, expiresInDays?: number) {
    const invitation = await this.getInOrg(organizationId, invitationId);
    if (!['pending', 'expired'].includes(invitation.status)) {
      throw ApiError.conflict(`Cannot resend an invitation that is ${invitation.status}.`);
    }
    const membership = await MembershipModel.findById(invitation.membershipId, { status: 1 }).lean();
    if (membership?.status !== 'invited') throw ApiError.conflict('The membership for this invitation is no longer pending.');

    const now = new Date();
    invitation.status = 'pending';
    invitation.expiresAt = new Date(now.getTime() + (expiresInDays ?? DEFAULT_INVITATION_DAYS) * DAY_MS);
    invitation.delivery = { status: 'queued', attempts: 0, nextAttemptAt: now };
    await invitation.save();
    await auditService.record({
      actorId,
      organizationId,
      action: 'invitation.resent',
      resource: 'invitation',
      resourceId: invitationId,
      result: 'success',
      meta,
    });
    invitationDelivery.trigger();
    return toPublicInvitation(invitation.toObject());
  },

  /** Revokes a pending invitation, and the invited membership with it. */
  async revoke(organizationId: string, invitationId: string, actorId: string, meta: RequestMeta) {
    await inTransaction(async (session) => {
      const now = new Date();
      const invitation = await InvitationModel.findOneAndUpdate(
        { _id: invitationId, organizationId, status: { $in: ['pending', 'expired'] } },
        { $set: { status: 'revoked', revokedAt: now } },
        { session },
      );
      if (!invitation) throw ApiError.notFound('Pending invitation not found');
      await MembershipModel.updateOne(
        { _id: invitation.membershipId, status: 'invited' },
        { $set: { status: 'revoked', revokedAt: now } },
        { session },
      );
      await auditService.record(
        { actorId, organizationId, action: 'invitation.revoked', resource: 'invitation', resourceId: invitationId, result: 'success', meta },
        session,
      );
    });
  },

  /** Public: lets the acceptance screen show who is inviting whom before the user commits. */
  async preview(token: string) {
    const invitation = await findUsableByToken(token);
    const [org, credential] = await Promise.all([
      OrganizationModel.findById(invitation.organizationId, { name: 1, logo: 1, status: 1 }).lean(),
      CredentialModel.exists({ userId: invitation.userId }),
    ]);
    if (!org || !ACCEPTING_ORG_STATUSES.includes(org.status)) throw INVALID_LINK();
    return {
      email: invitation.email,
      organization: { name: org.name, logo: org.logo ?? null },
      expiresAt: invitation.expiresAt,
      /** true → the user must sign in and accept; false → they set a password here. */
      accountExists: !!credential,
    };
  },

  /**
   * Accepts an invitation (FRD §14.3 screen 5). Holding the emailed token proves control of the
   * address, so it also verifies the email.
   *  - New identity (no credential): `password` is required and becomes the account password.
   *  - Existing identity: the caller must be signed in as the invited user; no password is set.
   * Accepting the initial School Admin invitation activates the organization (FRD §5.3 steps 10–13).
   */
  async accept(
    input: { token: string; password?: string; firstName?: string; lastName?: string },
    authUserId: string | undefined,
    meta: RequestMeta,
  ) {
    // Hash before the transaction: it's slow and needs no DB state.
    const passwordHash = input.password ? await passwordService.hash(input.password) : undefined;

    const result = await inTransaction(async (session) => {
      const invitation = await findUsableByToken(input.token, session);
      const [org, user, credential] = await Promise.all([
        OrganizationModel.findById(invitation.organizationId).session(session),
        UserModel.findById(invitation.userId).session(session),
        CredentialModel.findOne({ userId: invitation.userId }).session(session),
      ]);
      if (!org || !ACCEPTING_ORG_STATUSES.includes(org.status)) throw INVALID_LINK();
      if (!user || ['deleted', 'suspended', 'inactive', 'locked'].includes(user.status)) {
        throw new ApiError('ACCOUNT_DISABLED', 'This account is not active. Contact your administrator.');
      }

      if (credential) {
        if (authUserId !== String(user._id)) {
          throw new ApiError('UNAUTHENTICATED', 'Sign in as the invited user to accept this invitation.', {
            reason: 'login_required',
          });
        }
      } else {
        if (!passwordHash) throw ApiError.badRequest('Choose a password to create your account.', { password: ['Required'] });
        if (authUserId && authUserId !== String(user._id)) {
          throw new ApiError('FORBIDDEN', 'This invitation was sent to a different account. Sign out and try again.');
        }
        await CredentialModel.create([{ userId: user._id, passwordHash, passwordChangedAt: new Date() }], { session });
        if (input.firstName) user.firstName = input.firstName;
        if (input.lastName) user.lastName = input.lastName;
      }

      user.emailVerified = true;
      if (['invited', 'pending_verification'].includes(user.status)) user.status = 'active';
      await user.save({ session });

      const now = new Date();
      const membership = await MembershipModel.findOneAndUpdate(
        { _id: invitation.membershipId, status: 'invited' },
        { $set: { status: 'active', roles: invitation.proposedRoles, joinedAt: now } },
        { session, returnDocument: 'after' },
      );
      if (!membership) throw INVALID_LINK();

      invitation.status = 'accepted';
      invitation.acceptedAt = now;
      await invitation.save({ session });

      if (invitation.purpose === 'initial_admin' && org.onboarding?.state === 'invitation_pending') {
        org.onboarding.state = 'active';
        org.onboarding.adminActivatedAt = now;
        org.onboarding.completedAt = now;
        org.status = 'active';
        await org.save({ session });
        await auditService.record(
          {
            actorId: String(user._id),
            organizationId: String(org._id),
            action: 'organization.activated',
            resource: 'organization',
            resourceId: String(org._id),
            result: 'success',
            metadata: { via: 'initial_admin_accepted' },
            meta,
          },
          session,
        );
      }

      await auditService.record(
        {
          actorId: String(user._id),
          organizationId: String(org._id),
          action: 'invitation.accepted',
          resource: 'invitation',
          resourceId: String(invitation._id),
          result: 'success',
          metadata: { accountCreated: !credential },
          meta,
        },
        session,
      );
      return { organizationId: String(org._id), membershipId: String(membership._id), accountCreated: !credential };
    });

    return { ...result, nextStep: authUserId ? 'select_organization' : 'sign_in' };
  },
};
