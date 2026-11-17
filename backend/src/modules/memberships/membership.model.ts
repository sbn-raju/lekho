import { Schema, Types, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'inactive', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Status changes allowed through PATCH /memberships/:id/status. `invited → active` happens only by
 * accepting an invitation; `→ revoked` only through DELETE; leaving `revoked` requires a new invitation.
 */
export const MEMBERSHIP_STATUS_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  invited: [],
  active: ['suspended', 'inactive'],
  suspended: ['active', 'inactive'],
  inactive: ['active'],
  revoked: [],
};

/** Connects a global user to one organization (FRD §7, §13.7). */
const membershipSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    roles: [{ type: Types.ObjectId, ref: 'Role' }],
    /** Organization units (departments) arrive in Phase 4. */
    organizationUnitIds: [{ type: Types.ObjectId, ref: 'OrganizationUnit' }],
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true, default: 'invited' },
    invitedBy: { type: Types.ObjectId, ref: 'User' },
    approvedBy: { type: Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true, collection: 'memberships' },
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, status: 1 });
membershipSchema.index({ userId: 1, status: 1 });
membershipSchema.index({ organizationId: 1, roles: 1 });

export type Membership = InferSchemaType<typeof membershipSchema>;
export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipModel = model('Membership', membershipSchema);

/** Active and not past its expiry date. */
export function isMembershipUsable(m: Pick<Membership, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return m.status === 'active' && (!m.expiresAt || m.expiresAt > now);
}

export function toPublicMembership(m: Membership & { _id: unknown }) {
  return {
    id: String(m._id),
    userId: String(m.userId),
    organizationId: String(m.organizationId),
    roleIds: (m.roles ?? []).map(String),
    organizationUnitIds: (m.organizationUnitIds ?? []).map(String),
    status: m.status,
    invitedBy: m.invitedBy ? String(m.invitedBy) : null,
    joinedAt: m.joinedAt ?? null,
    expiresAt: m.expiresAt ?? null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
