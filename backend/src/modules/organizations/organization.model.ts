import { Schema, Types, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const ORGANIZATION_STATUSES = ['draft', 'onboarding', 'active', 'suspended', 'inactive', 'archived'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Provisioning state machine (FRD §5.3). Kept separate from `status`, which is the tenant lifecycle. */
export const ONBOARDING_STATES = [
  'draft',
  'organization_created',
  'admin_provisioning',
  'invitation_pending',
  'admin_activated',
  'active',
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** Allowed manual status changes via PATCH /platform/organizations/:id/status. */
export const ORGANIZATION_STATUS_TRANSITIONS: Record<OrganizationStatus, readonly OrganizationStatus[]> = {
  draft: ['archived'],
  onboarding: ['active', 'archived'],
  active: ['suspended', 'inactive', 'archived'],
  suspended: ['active', 'inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: [],
};

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: ['school'], required: true, default: 'school' },
    contact: {
      email: { type: String, required: true, trim: true },
      phone: { type: String, trim: true },
    },
    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      postalCode: { type: String, trim: true },
    },
    logo: { type: String },
    status: { type: String, enum: ORGANIZATION_STATUSES, required: true, default: 'draft' },
    settings: {
      timezone: { type: String, required: true, default: 'Asia/Kolkata' },
      academicYear: { type: String },
      /** Maximum depth of the organizational tree (FRD §11 "configure hierarchy depth"). */
      hierarchyMaxDepth: { type: Number, min: 1, max: 10, default: 6 },
    },
    onboarding: {
      state: { type: String, enum: ONBOARDING_STATES, required: true, default: 'organization_created' },
      adminInvitationId: { type: Types.ObjectId, ref: 'Invitation' },
      adminActivatedAt: { type: Date },
      completedAt: { type: Date },
    },
    /**
     * The initial School Admin (FRD §8.4). Their membership and School Admin role are protected:
     * organization users cannot suspend, revoke or demote them; only the platform can.
     */
    primaryAdminUserId: { type: Types.ObjectId, ref: 'User' },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'organizations' },
);

organizationSchema.index({ slug: 1 }, { unique: true });
organizationSchema.index({ code: 1 }, { unique: true });
organizationSchema.index({ status: 1 });

export type Organization = InferSchemaType<typeof organizationSchema>;
export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationModel = model('Organization', organizationSchema);

export function toPublicOrganization(org: Organization & { _id: unknown }) {
  return {
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    code: org.code,
    type: org.type,
    contact: org.contact,
    address: org.address ?? {},
    logo: org.logo ?? null,
    status: org.status,
    settings: org.settings,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

/** Platform view adds onboarding progress. */
export function toPlatformOrganization(org: Organization & { _id: unknown }) {
  return {
    ...toPublicOrganization(org),
    onboarding: {
      state: org.onboarding?.state,
      adminInvitationId: org.onboarding?.adminInvitationId ? String(org.onboarding.adminInvitationId) : null,
      adminActivatedAt: org.onboarding?.adminActivatedAt ?? null,
      completedAt: org.onboarding?.completedAt ?? null,
    },
    primaryAdminUserId: org.primaryAdminUserId ? String(org.primaryAdminUserId) : null,
  };
}
