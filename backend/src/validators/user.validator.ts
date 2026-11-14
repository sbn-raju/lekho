import { z } from 'zod';
import { USER_ROLES } from '../models/user.model.js';

export const userIdParams = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user id'),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  role: z.enum(USER_ROLES).optional(),
});

export const updateUserSchema = createUserSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
