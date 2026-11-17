import { Schema, Types, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const;
export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'retrying', 'failed'] as const;

/**
 * Invitation to join an organization (FRD §13.11). Only the token hash is stored. Email delivery
 * is a retryable background job tracked in `delivery`; each delivery attempt mints a fresh token
 * (so no raw token ever needs to be persisted), which also means only the newest email's link works.
 */
const invitationSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    membershipId: { type: Types.ObjectId, ref: 'Membership', required: true },
    email: { type: String, required: true },
    normalizedEmail: { type: String, required: true },
    purpose: { type: String, enum: ['member', 'initial_admin'], required: true, default: 'member' },
    invitedBy: { type: Types.ObjectId, ref: 'User', required: true },
    proposedRoles: [{ type: Types.ObjectId, ref: 'Role' }],
    /** Unset until the first delivery attempt mints a token. */
    tokenHash: { type: String },
    status: { type: String, enum: INVITATION_STATUSES, required: true, default: 'pending' },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
    delivery: {
      status: { type: String, enum: DELIVERY_STATUSES, required: true, default: 'queued' },
      attempts: { type: Number, required: true, default: 0 },
      nextAttemptAt: { type: Date, required: true, default: () => new Date() },
      lockedUntil: { type: Date },
      sentAt: { type: Date },
      lastError: { type: String },
    },
  },
  { timestamps: true, collection: 'invitations' },
);

invitationSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } });
invitationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
invitationSchema.index({ organizationId: 1, normalizedEmail: 1, status: 1 });
invitationSchema.index({ status: 1, 'delivery.status': 1, 'delivery.nextAttemptAt': 1 });

export type Invitation = InferSchemaType<typeof invitationSchema>;
export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationModel = model('Invitation', invitationSchema);

export function toPublicInvitation(inv: Invitation & { _id: unknown }) {
  const expired = inv.status === 'pending' && inv.expiresAt <= new Date();
  return {
    id: String(inv._id),
    organizationId: String(inv.organizationId),
    userId: String(inv.userId),
    membershipId: String(inv.membershipId),
    email: inv.email,
    purpose: inv.purpose,
    invitedBy: String(inv.invitedBy),
    proposedRoleIds: (inv.proposedRoles ?? []).map(String),
    status: expired ? 'expired' : inv.status,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt ?? null,
    delivery: {
      status: inv.delivery?.status,
      attempts: inv.delivery?.attempts ?? 0,
      sentAt: inv.delivery?.sentAt ?? null,
    },
    createdAt: inv.createdAt,
  };
}
