import { z } from 'zod';
import { objectId, paginationQuery } from '../../common/utils/pagination.js';
import { PLATFORM_MEMBERSHIP_STATUSES } from './platform-membership.model.js';

export const createPlatformUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().pipe(z.email().max(254)),
  phone: z.string().trim().max(30).optional(),
  roleIds: z.array(objectId).max(20).default([]),
});

export const updatePlatformUserSchema = z
  .object({
    roleIds: z.array(objectId).max(20).optional(),
    status: z.enum(PLATFORM_MEMBERSHIP_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listPlatformUsersQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(PLATFORM_MEMBERSHIP_STATUSES).optional(),
});
