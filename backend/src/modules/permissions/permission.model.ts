import { Schema, model, type InferSchemaType } from 'mongoose';
import { getPermissionDefinition } from './permission.catalog.js';

/** Database mirror of PERMISSION_CATALOG (FRD §13.9). Written only by `permissionService.sync()`. */
const permissionSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true },
    resource: { type: String, required: true },
    action: { type: String, required: true },
    module: { type: String, required: true },
    level: { type: String, enum: ['platform', 'organization'], required: true },
    description: { type: String },
    isSystem: { type: Boolean, required: true, default: true },
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
  },
  { timestamps: true, collection: 'permissions' },
);

permissionSchema.index({ code: 1, level: 1 }, { unique: true });
permissionSchema.index({ module: 1 });

export type Permission = InferSchemaType<typeof permissionSchema>;
export const PermissionModel = model('Permission', permissionSchema);

export function toPublicPermission(p: Permission & { _id: unknown }) {
  return {
    id: String(p._id),
    code: p.code,
    name: p.name,
    resource: p.resource,
    action: p.action,
    module: p.module,
    level: p.level,
    description: p.description ?? null,
    status: p.status,
    /** true → can be narrowed by department/class/section/assigned/own/custom scopes. */
    scopable: !!getPermissionDefinition(p.code)?.scopedResource,
    scopedResource: getPermissionDefinition(p.code)?.scopedResource ?? null,
  };
}
