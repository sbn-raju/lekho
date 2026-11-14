import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { normalizeEmail } from '../../common/utils/crypto.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { auditService } from '../audit/audit.service.js';
import { roleService } from '../roles/role.service.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { InvitationModel, toPublicInvitation } from '../invitations/invitation.model.js';
import { invitationService } from '../invitations/invitation.service.js';
import { invitationDelivery } from '../invitations/invitation.delivery.js';
import { OrganizationModel, toPlatformOrganization } from './organization.model.js';
import type { ProvisionAdminInput } from './organization.validators.js';

/**
 * Initial School Admin provisioning (FRD §5.3 steps 5–9).
 *
 * Recoverability: user, membership, protected role assignment, invitation and the onboarding
 * state change commit in one transaction, so a crash leaves either nothing or a complete
 * `invitation_pending` organization. Email goes out afterwards through the retrying delivery
 * worker. The call is idempotent: repeating it with the same email returns the existing
 * provisioning (re-queuing a failed email); a different email replaces a not-yet-accepted admin.
 */
export const onboardingService = {
  async provisionInitialAdmin(organizationId: string, input: ProvisionAdminInput, actorId: string, meta: RequestMeta) {
    const outcome = await inTransaction(async (session) => {
      const org = await OrganizationModel.findById(organizationId).session(session);
      if (!org) throw ApiError.notFound('Organization not found');
      if (!['draft', 'onboarding'].includes(org.status) || ['admin_activated', 'active'].includes(org.onboarding?.state ?? '')) {
        throw ApiError.conflict('This organization already has an activated School Admin.');
      }

      const existing = org.onboarding?.adminInvitationId
        ? await InvitationModel.findById(org.onboarding.adminInvitationId).session(session)
        : null;

      if (existing && ['pending', 'expired'].includes(existing.status)) {
        if (existing.normalizedEmail === normalizeEmail(input.email)) {
          // Idempotent retry: same admin. Renew if expired, re-queue if delivery gave up.
          if (existing.status === 'expired' || existing.expiresAt <= new Date() || existing.delivery?.status === 'failed') {
            existing.status = 'pending';
            existing.expiresAt = new Date(Date.now() + (input.invitationExpiryDays ?? 7) * 24 * 60 * 60 * 1000);
            existing.delivery = { status: 'queued', attempts: 0, nextAttemptAt: new Date() };
            await existing.save({ session });
          }
          return { org, invitation: existing, replaced: false, idempotent: true };
        }
        // Different person: retire the previous, never-accepted admin invitation and membership.
        const now = new Date();
        existing.status = 'revoked';
        existing.revokedAt = now;
        await existing.save({ session });
        await MembershipModel.updateOne(
          { _id: existing.membershipId, status: 'invited' },
          { $set: { status: 'revoked', revokedAt: now } },
          { session },
        );
      }

      await roleService.ensureSystemRoles(org._id, actorId, session);
      const adminRoleId = await roleService.getSchoolAdminRoleId(organizationId, session);
      const { user, invitation } = await invitationService.invite(
        {
          organizationId,
          actorId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          roleIds: [new Types.ObjectId(adminRoleId!)],
          expiresInDays: input.invitationExpiryDays,
          purpose: 'initial_admin',
        },
        session,
      );

      org.status = 'onboarding';
      org.onboarding!.state = 'invitation_pending';
      org.onboarding!.adminInvitationId = invitation!._id;
      org.primaryAdminUserId = user._id;
      await org.save({ session });

      await auditService.record(
        {
          actorId,
          organizationId,
          action: 'organization.admin_provisioned',
          resource: 'organization',
          resourceId: organizationId,
          result: 'success',
          after: { adminUserId: String(user._id), invitationId: String(invitation!._id) },
          ...(existing && { metadata: { replacedInvitationId: String(existing._id) } }),
          meta,
        },
        session,
      );
      return { org, invitation: invitation!, replaced: !!existing, idempotent: false };
    });

    invitationDelivery.trigger();
    return {
      organization: toPlatformOrganization(outcome.org.toObject()),
      invitation: toPublicInvitation(outcome.invitation.toObject()),
      idempotent: outcome.idempotent,
    };
  },

  /** Screen 4 "Resend invitation" for the initial admin. */
  async resendInitialAdminInvitation(organizationId: string, actorId: string, meta: RequestMeta) {
    const org = await OrganizationModel.findById(organizationId).lean();
    if (!org) throw ApiError.notFound('Organization not found');
    if (!org.onboarding?.adminInvitationId) throw ApiError.conflict('No School Admin has been provisioned yet.');
    return invitationService.resend(organizationId, String(org.onboarding.adminInvitationId), actorId, meta);
  },
};
