import { Schema, Types, model } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';

/** The only allowed _id. Because _id is unique, a second Super Admin record cannot be inserted. */
export const PLATFORM_ADMIN_ID = 'platform_admin';

/** Singleton that designates the one Super Admin (FRD §13.12, §16). Written only by the bootstrap. */
const platformAdminSchema = new Schema(
  {
    _id: { type: String, required: true, enum: [PLATFORM_ADMIN_ID] },
    superAdminUserId: { type: Types.ObjectId, ref: 'User', required: true },
    initialized: { type: Boolean, required: true },
    initializedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: 'platform_admin', versionKey: false },
);

export const PlatformAdminModel = model('PlatformAdmin', platformAdminSchema);

export const platformAdminService = {
  async getSuperAdminUserId(): Promise<string | null> {
    const record = await PlatformAdminModel.findById(PLATFORM_ADMIN_ID).lean();
    return record?.initialized ? String(record.superAdminUserId) : null;
  },

  async isSuperAdmin(userId: string): Promise<boolean> {
    return (await this.getSuperAdminUserId()) === userId;
  },

  /** Guard for user-management APIs (Phase 2): the Super Admin cannot be modified through them (FRD §16.3). */
  async assertNotSuperAdmin(userId: string): Promise<void> {
    if (await this.isSuperAdmin(userId)) {
      throw new ApiError('ROLE_PROTECTED', 'The Super Admin account cannot be modified through this API.');
    }
  },
};
