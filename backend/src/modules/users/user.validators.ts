import { z } from 'zod';
import { objectId, paginationQuery } from '../../common/utils/pagination.js';
import { MEMBERSHIP_STATUSES } from '../memberships/membership.model.js';

const name = z.string().trim().min(1).max(100);
const phone = z.string().trim().max(30);

export const createOrgUserSchema = z.object({
  firstName: name,
  lastName: name,
  email: z.string().trim().pipe(z.email().max(254)),
  phone: phone.optional(),
  roleIds: z.array(objectId).max(20).optional(),
  sendInvitation: z.boolean().optional(),
  invitationExpiryDays: z.number().int().min(1).max(30).optional(),
});

export const updateOrgUserSchema = z
  .object({ firstName: name.optional(), lastName: name.optional(), phone: phone.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listOrgUsersQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  roleId: objectId.optional(),
  /** Members of this unit or its sub-units. */
  unitId: objectId.optional(),
});

export const userStatusSchema = z.object({ status: z.enum(['active', 'suspended', 'inactive']) });

export const inviteUserSchema = z.object({ invitationExpiryDays: z.number().int().min(1).max(30).optional() });

export type CreateOrgUserBody = z.infer<typeof createOrgUserSchema>;
