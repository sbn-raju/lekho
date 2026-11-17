import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { escapeRegex, paginated } from '../../common/utils/pagination.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { auditService } from '../audit/audit.service.js';
import { roleService } from '../roles/role.service.js';
import { MembershipModel, isMembershipUsable } from '../memberships/membership.model.js';
import {
  OrganizationModel,
  ORGANIZATION_STATUS_TRANSITIONS,
  toPlatformOrganization,
  toPublicOrganization,
  type OrganizationStatus,
} from './organization.model.js';
import type {
  CreateOrganizationInput,
  ListOrganizationsQuery,
  UpdateOrganizationPlatformInput,
  UpdateOrganizationSelfInput,
  UpdateSettingsInput,
} from './organization.validators.js';

/** Flattens nested objects into dot paths so a partial PATCH doesn't wipe sibling fields. */
function toSetPaths(input: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(out, toSetPaths(value as Record<string, unknown>, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

async function findOrThrow(id: string) {
  const org = await OrganizationModel.findById(id);
  if (!org) throw ApiError.notFound('Organization not found');
  return org;
}

export const organizationService = {
  // ---------- Platform (Super Admin) ----------

  async create(input: CreateOrganizationInput, actorId: string, meta: RequestMeta) {
    const { saveAsDraft, ...data } = input;
    const org = await inTransaction(async (session) => {
      const [created] = await OrganizationModel.create(
        [
          {
            ...data,
            status: 'draft',
            onboarding: { state: saveAsDraft ? 'draft' : 'organization_created' },
            createdBy: actorId,
          },
        ],
        { session },
      );
      await roleService.ensureSystemRoles(created!._id, actorId, session);
      await auditService.record(
        {
          actorId,
          organizationId: String(created!._id),
          action: 'organization.created',
          resource: 'organization',
          resourceId: String(created!._id),
          result: 'success',
          after: { name: created!.name, slug: created!.slug, code: created!.code },
          meta,
        },
        session,
      );
      return created!;
    });
    return toPlatformOrganization(org.toObject());
  },

  async list(query: ListOrganizationsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: rx }, { slug: rx }, { code: rx }, { 'contact.email': rx }];
    }
    const [items, total] = await Promise.all([
      OrganizationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      OrganizationModel.countDocuments(filter),
    ]);
    return paginated(items.map(toPlatformOrganization), total, query);
  },

  async getForPlatform(id: string) {
    return toPlatformOrganization((await findOrThrow(id)).toObject());
  },

  async updateForPlatform(id: string, input: UpdateOrganizationPlatformInput, actorId: string, meta: RequestMeta) {
    const before = await findOrThrow(id);
    if (before.status === 'archived') throw ApiError.conflict('Archived organizations cannot be modified.');
    const updated = await OrganizationModel.findByIdAndUpdate(id, { $set: toSetPaths(input) }, { returnDocument: 'after', runValidators: true });
    await auditService.record({
      actorId,
      organizationId: id,
      action: 'organization.updated',
      resource: 'organization',
      resourceId: id,
      result: 'success',
      before: { fields: Object.keys(input) },
      after: toSetPaths(input),
      meta,
    });
    return toPlatformOrganization(updated!.toObject());
  },

  async changeStatus(id: string, status: OrganizationStatus, reason: string | undefined, actorId: string, meta: RequestMeta) {
    const org = await findOrThrow(id);
    const from = org.status;
    if (from === status) return toPlatformOrganization(org.toObject());
    if (!ORGANIZATION_STATUS_TRANSITIONS[from].includes(status)) {
      throw ApiError.conflict(`Cannot change organization status from ${from} to ${status}.`);
    }
    if (status === 'active') {
      // A school can't go live without someone able to administer it.
      const admin = org.primaryAdminUserId
        ? await MembershipModel.findOne({ organizationId: id, userId: org.primaryAdminUserId }).lean()
        : null;
      if (!admin || !isMembershipUsable(admin)) {
        throw ApiError.conflict('The initial School Admin must accept their invitation before the organization can be activated.');
      }
      if (org.onboarding && org.onboarding.state !== 'active') {
        org.onboarding.state = 'active';
        org.onboarding.completedAt = new Date();
      }
    }
    org.status = status;
    await org.save();
    await auditService.record({
      actorId,
      organizationId: id,
      action: 'organization.status_changed',
      resource: 'organization',
      resourceId: id,
      result: 'success',
      before: { status: from },
      after: { status },
      ...(reason && { metadata: { reason } }),
      meta,
    });
    return toPlatformOrganization(org.toObject());
  },

  // ---------- Organization-scoped (members / School Admin) ----------

  async getForMember(organizationId: string) {
    return toPublicOrganization((await findOrThrow(organizationId)).toObject());
  },

  async updateForAdmin(organizationId: string, input: UpdateOrganizationSelfInput, actorId: string, meta: RequestMeta) {
    const { logo, ...rest } = input;
    const update: Record<string, unknown> = { $set: toSetPaths(rest) };
    if (logo === null) update.$unset = { logo: 1 };
    else if (logo !== undefined) (update.$set as Record<string, unknown>).logo = logo;
    const updated = await OrganizationModel.findByIdAndUpdate(organizationId, update, { returnDocument: 'after', runValidators: true });
    if (!updated) throw ApiError.notFound('Organization not found');
    await auditService.record({
      actorId,
      organizationId,
      action: 'organization.updated',
      resource: 'organization',
      resourceId: organizationId,
      result: 'success',
      after: { fields: Object.keys(input) },
      meta,
    });
    return toPublicOrganization(updated.toObject());
  },

  async getSettings(organizationId: string) {
    return (await findOrThrow(organizationId)).toObject().settings;
  },

  async updateSettings(organizationId: string, input: UpdateSettingsInput, actorId: string, meta: RequestMeta) {
    const before = (await findOrThrow(organizationId)).toObject().settings;
    const updated = await OrganizationModel.findByIdAndUpdate(
      organizationId,
      { $set: toSetPaths(input, 'settings') },
      { returnDocument: 'after', runValidators: true },
    );
    await auditService.record({
      actorId,
      organizationId,
      action: 'organization.settings_updated',
      resource: 'organization',
      resourceId: organizationId,
      result: 'success',
      before: { ...before },
      after: { ...updated!.toObject().settings },
      meta,
    });
    return updated!.toObject().settings;
  },
};
