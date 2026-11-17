import { Schema, Types, model, type InferSchemaType } from 'mongoose';

export const PLATFORM_MEMBERSHIP_STATUSES = ['active', 'suspended', 'inactive'] as const;

/**
 * Makes a global user platform staff and holds their platform roles (FRD §3.1 "Platform Staff").
 * The platform-level counterpart of an organization membership. The Super Admin needs no record
 * here: that authority comes from the `platform_admin` singleton and can't be granted by a role.
 */
const platformMembershipSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    roles: [{ type: Types.ObjectId, ref: 'Role' }],
    status: { type: String, enum: PLATFORM_MEMBERSHIP_STATUSES, required: true, default: 'active' },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'platform_memberships' },
);

platformMembershipSchema.index({ userId: 1 }, { unique: true });
platformMembershipSchema.index({ roles: 1 });

export type PlatformMembership = InferSchemaType<typeof platformMembershipSchema>;
export const PlatformMembershipModel = model('PlatformMembership', platformMembershipSchema);
