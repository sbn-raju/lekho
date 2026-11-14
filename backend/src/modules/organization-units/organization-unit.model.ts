import { Schema, Types, model, type InferSchemaType } from 'mongoose';

/**
 * Unit types (FRD §11, §13.10). `class` and `section` are included so class/section scopes have
 * real entities to point at before the academic module exists; a section's parent must be a class.
 */
export const ORGANIZATION_UNIT_TYPES = ['department', 'academic', 'administration', 'class', 'section', 'custom'] as const;
export type OrganizationUnitType = (typeof ORGANIZATION_UNIT_TYPES)[number];

export const DEFAULT_HIERARCHY_MAX_DEPTH = 6;
export const MAX_HIERARCHY_DEPTH = 10;

/**
 * A node of a school's organizational tree. Departments are organizational entities, not roles:
 * a "Department Head" is a user who belongs to the unit and holds a role whose grants are
 * department-scoped. `headUserIds` records who leads the unit, for display and reporting only;
 * it confers no authority.
 */
const organizationUnitSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    type: { type: String, enum: ORGANIZATION_UNIT_TYPES, required: true },
    description: { type: String, maxlength: 500 },
    parentId: { type: Types.ObjectId, ref: 'OrganizationUnit' },
    /** Root-first list of ancestor IDs (materialized path) for subtree queries. */
    ancestors: [{ type: Types.ObjectId, ref: 'OrganizationUnit' }],
    /** 1 for top-level units. */
    depth: { type: Number, required: true, default: 1 },
    headUserIds: [{ type: Types.ObjectId, ref: 'User' }],
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'organization_units' },
);

organizationUnitSchema.index({ organizationId: 1, code: 1 }, { unique: true });
organizationUnitSchema.index({ organizationId: 1, parentId: 1 });
organizationUnitSchema.index({ organizationId: 1, ancestors: 1 });
organizationUnitSchema.index({ organizationId: 1, type: 1 });

export type OrganizationUnit = InferSchemaType<typeof organizationUnitSchema>;
export const OrganizationUnitModel = model('OrganizationUnit', organizationUnitSchema);

export function toPublicUnit(u: OrganizationUnit & { _id: unknown }, extra: Record<string, unknown> = {}) {
  return {
    id: String(u._id),
    organizationId: String(u.organizationId),
    name: u.name,
    code: u.code,
    type: u.type,
    description: u.description ?? null,
    parentId: u.parentId ? String(u.parentId) : null,
    ancestorIds: (u.ancestors ?? []).map(String),
    depth: u.depth,
    headUserIds: (u.headUserIds ?? []).map(String),
    status: u.status,
    ...extra,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
