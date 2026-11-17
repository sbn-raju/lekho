import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../errors/ApiError.js';
import { requireAuth } from '../utils/request.js';
import { OrganizationModel } from '../../modules/organizations/organization.model.js';
import { MembershipModel, isMembershipUsable } from '../../modules/memberships/membership.model.js';

export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * Resolves and validates the tenant for organization-scoped APIs (FRD §10.4 steps 2–4, §15.2).
 * The organization comes from `X-Organization-Id` (lets two tabs work in different schools) or
 * else the session's active organization. Then: the organization must be active and the caller
 * must hold an active, unexpired membership in it. Must run after `authenticate`.
 */
export const organizationContext: RequestHandler = async (req, _res, next) => {
  const { userId, activeOrganizationId } = requireAuth(req);
  const organizationId = req.get(ORGANIZATION_HEADER) ?? activeOrganizationId;
  if (!organizationId) {
    throw new ApiError('ORGANIZATION_CONTEXT_REQUIRED', 'Select an organization first (POST /me/active-organization).');
  }
  if (!Types.ObjectId.isValid(organizationId)) throw new ApiError('TENANT_MISMATCH', 'Invalid organization.');

  const [org, membership] = await Promise.all([
    OrganizationModel.findById(organizationId, { status: 1 }).lean(),
    MembershipModel.findOne({ userId, organizationId }, { status: 1, expiresAt: 1, roles: 1, organizationUnitIds: 1 }).lean(),
  ]);

  // Same answer for "no such organization" and "not a member", so IDs can't be probed.
  if (!org || !membership) throw new ApiError('TENANT_MISMATCH', 'You are not a member of this organization.');
  if (!isMembershipUsable(membership)) {
    throw new ApiError('MEMBERSHIP_INACTIVE', 'Your membership in this organization is not active.');
  }
  if (org.status !== 'active') throw new ApiError('ORGANIZATION_INACTIVE', 'This organization is not active.');

  req.org = {
    organizationId,
    membershipId: String(membership._id),
    roleIds: (membership.roles ?? []).map(String),
    unitIds: (membership.organizationUnitIds ?? []).map(String),
  };
  next();
};
