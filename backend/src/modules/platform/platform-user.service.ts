import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { normalizeEmail } from '../../common/utils/crypto.js';
import { escapeRegex, paginated, type Pagination } from '../../common/utils/pagination.js';
import { inTransaction } from '../../common/utils/transaction.js';
import { auditService } from '../audit/audit.service.js';
import { authService } from '../auth/auth.service.js';
import { authorizationService, grantedCodes } from '../authorization/authorization.service.js';
import { assertCovers } from '../authorization/escalation.js';
import { roleService, type RoleActor } from '../roles/role.service.js';
import { sessionService } from '../sessions/session.service.js';
import { UserModel, toPublicUser } from '../users/user.model.js';
import { PlatformMembershipModel } from './platform-membership.model.js';
import { platformAdminService } from './platform-admin.model.js';

const PLATFORM = { level: 'platform' } as const;

/** Platform staff management (FRD §3.1, §12.2 /platform/users). */
export const platformUserService = {
  async list(query: Pagination & { search?: string; status?: string }) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    let memberships = await PlatformMembershipModel.find(filter).sort({ createdAt: -1 }).lean();
    const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      memberships = memberships.filter((m) => {
        const u = byId.get(String(m.userId));
        return u && (rx.test(u.email) || rx.test(u.firstName) || rx.test(u.lastName));
      });
    }
    const page = memberships.slice((query.page - 1) * query.limit, query.page * query.limit);
    const items = await Promise.all(page.map((m) => this.view(m, byId.get(String(m.userId)))));
    return paginated(items.filter(Boolean), memberships.length, query);
  },

  async view(
    m: { _id: unknown; userId: Types.ObjectId; roles: Types.ObjectId[]; status: string; createdAt?: Date },
    user?: Parameters<typeof toPublicUser>[0] | null,
  ) {
    const u = user ?? (await UserModel.findById(m.userId).lean());
    if (!u) return null;
    const grants = await authorizationService.rolesGrants('platform', m.roles);
    return {
      ...toPublicUser(u),
      platformMembership: { id: String(m._id), status: m.status, roles: grants.roles, createdAt: m.createdAt },
    };
  },

  async get(userId: string) {
    const m = Types.ObjectId.isValid(userId) ? await PlatformMembershipModel.findOne({ userId }).lean() : null;
    if (!m) throw ApiError.notFound('Platform user not found');
    return (await this.view(m))!;
  },

  /**
   * Adds platform staff. A new identity gets a set-password email; an existing one is simply
   * granted platform access. Nobody can be made Super Admin this way (FRD §16.3).
   */
  async create(actor: RoleActor, input: { email: string; firstName: string; lastName: string; phone?: string; roleIds: string[] }) {
    const roleIds = await roleService.assertAssignableIn(PLATFORM, input.roleIds);
    await assertCovers(actor.grants, await authorizationService.rolesGrants('platform', roleIds), 'assign these platform roles');

    const normalizedEmail = normalizeEmail(input.email);
    const { user, created } = await inTransaction(async (session) => {
      let user = await UserModel.findOne({ normalizedEmail }).session(session);
      const created = !user;
      if (user) {
        if (await platformAdminService.isSuperAdmin(String(user._id))) {
          throw new ApiError('ROLE_PROTECTED', 'The Super Admin cannot be added as platform staff.');
        }
        if (['deleted', 'suspended', 'locked'].includes(user.status)) throw ApiError.conflict('This account is not available.');
        if (await PlatformMembershipModel.exists({ userId: user._id }).session(session)) {
          throw ApiError.conflict('This user is already platform staff.');
        }
      } else {
        [user] = await UserModel.create(
          [{ firstName: input.firstName, lastName: input.lastName, email: input.email.trim(), normalizedEmail, phone: input.phone, status: 'invited' }],
          { session },
        );
      }
      await PlatformMembershipModel.create([{ userId: user!._id, roles: roleIds, status: 'active', createdBy: actor.actorId }], { session });
      await auditService.record(
        {
          actorId: actor.actorId,
          action: 'platform.user_created',
          resource: 'platform_user',
          resourceId: String(user!._id),
          result: 'success',
          after: { roleIds: roleIds.map(String) },
          metadata: { identityCreated: created },
          meta: actor.meta,
        },
        session,
      );
      return { user: user!, created };
    });

    if (created) await authService.sendAccountSetupEmail(user, 'You have been added to the Lekho platform team.');
    return this.get(String(user._id));
  },

  /** Change a staff member's platform roles and/or status. Not on yourself, not on anyone more privileged. */
  async update(actor: RoleActor, userId: string, input: { roleIds?: string[]; status?: 'active' | 'suspended' | 'inactive' }) {
    if (userId === actor.actorId) throw ApiError.forbidden('You cannot change your own platform access.');
    const m = Types.ObjectId.isValid(userId) ? await PlatformMembershipModel.findOne({ userId }) : null;
    if (!m) throw ApiError.notFound('Platform user not found');
    await assertCovers(actor.grants, await authorizationService.rolesGrants('platform', m.roles), 'manage this staff member');

    const before = { roleIds: m.roles.map(String), status: m.status };
    if (input.roleIds) {
      const roleIds = await roleService.assertAssignableIn(PLATFORM, input.roleIds);
      await assertCovers(actor.grants, await authorizationService.rolesGrants('platform', roleIds), 'assign these platform roles');
      m.roles = roleIds;
    }
    if (input.status) m.status = input.status;
    await m.save();
    // Platform access is checked on every request; nothing else to revoke.
    await auditService.record({
      actorId: actor.actorId,
      action: 'platform.user_updated',
      resource: 'platform_user',
      resourceId: userId,
      result: 'success',
      before,
      after: { roleIds: m.roles.map(String), status: m.status },
      meta: actor.meta,
    });
    return this.get(userId);
  },

  async permissions(userId: string) {
    if (await platformAdminService.isSuperAdmin(userId)) {
      return { superAdmin: true, roles: [], permissions: grantedCodes(await authorizationService.platformGrants(userId)) };
    }
    await this.get(userId);
    const grants = await authorizationService.platformGrants(userId);
    return { superAdmin: false, roles: grants.roles, permissions: grantedCodes(grants) };
  },

  async sessions(userId: string) {
    await this.get(userId);
    return sessionService.listActive(userId, '');
  },
};
