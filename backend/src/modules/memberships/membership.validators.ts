import { z } from 'zod';
import { objectId, paginationQuery } from '../../common/utils/pagination.js';
import { MEMBERSHIP_STATUSES } from './membership.model.js';

export const listMembershipsQuery = paginationQuery.extend({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  roleId: objectId.optional(),
  userId: objectId.optional(),
});

export const updateMembershipSchema = z
  .object({
    roleIds: z.array(objectId).max(20).optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const membershipStatusSchema = z.object({ status: z.enum(['active', 'suspended', 'inactive']) });

export const activeOrganizationSchema = z.object({ organizationId: objectId });
