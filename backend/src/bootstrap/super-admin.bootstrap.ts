import mongoose from 'mongoose';
import { z } from 'zod';
import { normalizeEmail } from '../common/utils/crypto.js';
import { UserModel } from '../modules/users/user.model.js';
import { CredentialModel } from '../modules/users/credential.model.js';
import { PLATFORM_ADMIN_ID, PlatformAdminModel } from '../modules/platform/platform-admin.model.js';
import { passwordService } from '../modules/auth/password.service.js';
import { newPassword } from '../modules/auth/auth.validators.js';
import { auditService } from '../modules/audit/audit.service.js';

export const bootstrapInputSchema = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: newPassword,
});

export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;

export class BootstrapError extends Error {}

/**
 * Creates the single Super Admin (FRD §16.1). The user, credential and singleton record are
 * written in one transaction, and `platform_admin` has a fixed _id, so even two concurrent runs
 * can produce at most one Super Admin. Requires a replica set (MongoDB Atlas qualifies).
 *
 * Super Admin authority is the `platform_admin` record itself, not a role: Phase 3's roles must
 * consult `platformAdminService.isSuperAdmin()` and must never be able to grant it.
 */
export async function bootstrapSuperAdmin(raw: BootstrapInput): Promise<{ userId: string }> {
  const input = bootstrapInputSchema.parse(raw);
  const normalizedEmail = normalizeEmail(input.email);

  if (await PlatformAdminModel.exists({ _id: PLATFORM_ADMIN_ID })) {
    throw new BootstrapError('Platform is already initialized: a Super Admin exists. Refusing to create another.');
  }

  // Hash outside the transaction; it's slow and needs no DB state.
  const passwordHash = await passwordService.hash(input.password);
  const userId = new mongoose.Types.ObjectId();
  const now = new Date();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await UserModel.exists({ normalizedEmail }).session(session)) {
        throw new BootstrapError('A user with this email already exists. Use a dedicated address for the Super Admin.');
      }
      await UserModel.create(
        [
          {
            _id: userId,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email.trim(),
            normalizedEmail,
            status: 'active',
            emailVerified: true,
          },
        ],
        { session },
      );
      await CredentialModel.create([{ userId, passwordHash, passwordChangedAt: now }], { session });
      // Duplicate _id here aborts the whole transaction if another bootstrap won the race.
      await PlatformAdminModel.create(
        [{ _id: PLATFORM_ADMIN_ID, superAdminUserId: userId, initialized: true, initializedAt: now }],
        { session },
      );
      await auditService.record(
        {
          actorId: String(userId),
          action: 'platform.super_admin_bootstrapped',
          resource: 'platform_admin',
          resourceId: PLATFORM_ADMIN_ID,
          result: 'success',
          metadata: { via: 'bootstrap_cli' },
        },
        session,
      );
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new BootstrapError('Platform was initialized concurrently by another process. No changes were made.');
    }
    if ((err as { code?: number }).code === 20) {
      throw new BootstrapError('MongoDB transactions are unavailable. Bootstrap requires a replica set (Atlas, or a local single-node replica set).');
    }
    throw err;
  } finally {
    await session.endSession();
  }

  return { userId: String(userId) };
}
