import { Schema, Types, model, type InferSchemaType } from 'mongoose';

export const SCOPE_TYPES = ['platform', 'organization', 'department', 'class', 'section', 'assigned', 'own', 'custom'] as const;

/**
 * Role (FRD §13.8). A role's display name never confers privilege: authority comes only from the
 * catalog permissions listed here, plus two built-ins resolved by code, not by name:
 *  - the protected `school_admin` system role holds every organization permission implicitly;
 *  - Super Admin isn't a role at all (see platform_admin).
 * Lower `level` = more senior; used for ordering and display.
 */
const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, maxlength: 500 },
    type: { type: String, enum: ['platform', 'organization'], required: true },
    organizationId: { type: Types.ObjectId, ref: 'Organization' },
    level: { type: Number, required: true, default: 100 },
    isSystem: { type: Boolean, required: true, default: false },
    isProtected: { type: Boolean, required: true, default: false },
    permissions: [
      {
        _id: false,
        permissionId: { type: Types.ObjectId, ref: 'Permission', required: true },
        /** Denormalized catalog code (immutable) so authorization needs a single roles query. */
        code: { type: String, required: true },
        scopes: [
          {
            _id: false,
            type: { type: String, enum: SCOPE_TYPES, required: true },
            resourceIds: [{ type: Types.ObjectId }],
          },
        ],
      },
    ],
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'roles' },
);

roleSchema.index({ organizationId: 1, code: 1 }, { unique: true });
roleSchema.index({ type: 1, status: 1 });
roleSchema.index({ 'permissions.code': 1 });

export type Role = InferSchemaType<typeof roleSchema>;
export const RoleModel = model('Role', roleSchema);

export const SCHOOL_ADMIN_ROLE_CODE = 'school_admin';
