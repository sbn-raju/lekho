import { z } from 'zod';

const email = z.string().trim().pipe(z.email().max(254));
const token = z.string().min(16).max(512);

/** Password policy for new passwords. Length over composition rules (NIST SP 800-63B). */
export const newPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

export const loginSchema = z.object({
  email,
  // Not the new-password policy: old passwords may predate it. Cap length to bound hashing cost.
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().max(200).optional(),
});

export const refreshSchema = z.object({
  /** Mobile clients send the refresh token in the body; web clients rely on the HttpOnly cookie. */
  refreshToken: token.optional(),
});

export const tokenOnlySchema = z.object({ token });
export const emailOnlySchema = z.object({ email });

export const resetPasswordSchema = z.object({ token, password: newPassword });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword,
});

export const sessionIdParams = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid session id'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type TokenOnlyInput = z.infer<typeof tokenOnlySchema>;
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
