import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/utils/logger.js';
import { PERMISSION_CATALOG, PERMISSION_MODULES, type PermissionLevel } from './permission.catalog.js';
import { PermissionModel, toPublicPermission } from './permission.model.js';
import { RoleModel } from '../roles/role.model.js';

export const permissionService = {
  /**
   * Upserts the code catalog into MongoDB and deactivates entries that were removed from it.
   * Idempotent; runs at startup.
   */
  async sync(): Promise<void> {
    const ops = PERMISSION_CATALOG.map((p) => {
      const [resource, action] = p.code.split('.') as [string, string];
      return {
        updateOne: {
          filter: { code: p.code, level: p.level },
          update: {
            $set: { name: p.name, module: p.module, description: p.description, resource, action, status: 'active', isSystem: true },
          },
          upsert: true,
        },
      };
    });
    await PermissionModel.bulkWrite(ops);
    const registered = new Set(PERMISSION_CATALOG.map((p) => `${p.level}:${p.code}`));
    const stale = (await PermissionModel.find({ status: 'active' }, { code: 1, level: 1 }).lean()).filter(
      (p) => !registered.has(`${p.level}:${p.code}`),
    );
    if (stale.length) {
      await PermissionModel.updateMany({ _id: { $in: stale.map((p) => p._id) } }, { $set: { status: 'inactive' } });
      logger.warn(`Deactivated ${stale.length} permission(s) no longer in the catalog: ${stale.map((p) => p.code).join(', ')}`);
    }
  },

  async list(level: PermissionLevel, filter: { module?: string } = {}) {
    const items = await PermissionModel.find({ level, status: 'active', ...(filter.module && { module: filter.module }) })
      .sort({ module: 1, code: 1 })
      .lean();
    return items.map(toPublicPermission);
  },

  async get(level: PermissionLevel, id: string) {
    const p = Types.ObjectId.isValid(id) ? await PermissionModel.findOne({ _id: id, level }).lean() : null;
    if (!p) throw ApiError.notFound('Permission not found');
    return toPublicPermission(p);
  },

  modules(level: PermissionLevel) {
    const counts = new Map<string, number>();
    for (const p of PERMISSION_CATALOG) if (p.level === level) counts.set(p.module, (counts.get(p.module) ?? 0) + 1);
    return PERMISSION_MODULES[level].map((m) => ({ ...m, permissionCount: counts.get(m.code) ?? 0 }));
  },

  /** Platform screen 7: which roles use a permission. */
  async rolesUsing(level: PermissionLevel, id: string) {
    const p = await this.get(level, id);
    const roles = await RoleModel.find({ 'permissions.code': p.code, type: level }, { name: 1, code: 1, organizationId: 1 }).lean();
    return roles.map((r) => ({ id: String(r._id), name: r.name, code: r.code, organizationId: r.organizationId ? String(r.organizationId) : null }));
  },

  /**
   * Resolves permission references (IDs or codes) to active catalog entries of the given level.
   * Anything unknown, inactive or of the wrong level is rejected (FRD §23: unknown permissions
   * cannot be assigned; platform and organization permissions are separate).
   */
  async resolve(level: PermissionLevel, refs: string[]) {
    const unique = [...new Set(refs)];
    if (unique.length === 0) return [];
    const ids = unique.filter((r) => Types.ObjectId.isValid(r) && /^[0-9a-f]{24}$/i.test(r));
    const codes = unique.filter((r) => !ids.includes(r));
    const found = await PermissionModel.find({
      level,
      status: 'active',
      $or: [{ _id: { $in: ids } }, { code: { $in: codes } }],
    }).lean();
    const matched = new Set(found.flatMap((p) => [String(p._id), p.code]));
    const unknown = unique.filter((r) => !matched.has(r));
    if (unknown.length) {
      throw ApiError.badRequest(`Unknown or unassignable ${level} permission(s).`, { permissions: unknown });
    }
    return found.map((p) => ({ permissionId: p._id, code: p.code }));
  },
};
