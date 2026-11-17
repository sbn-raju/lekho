import { z } from 'zod';
import { paginationQuery } from '../../common/utils/pagination.js';
import { newPassword } from '../auth/auth.validators.js';
import { INVITATION_STATUSES } from './invitation.model.js';

const token = z.string().min(16).max(512);

export const listInvitationsQuery = paginationQuery.extend({ status: z.enum(INVITATION_STATUSES).optional() });

export const previewInvitationSchema = z.object({ token });

export const acceptInvitationSchema = z.object({
  token,
  /** Required when the invited identity has no password yet (preview says accountExists: false). */
  password: newPassword.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});

export const resendInvitationSchema = z.object({ invitationExpiryDays: z.number().int().min(1).max(30).optional() });
