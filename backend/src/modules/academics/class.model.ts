import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const MAX_SECTION_CAPACITY = 500;
export const DEFAULT_SECTION_CAPACITY = 40;

/**
 * A class (grade / standard), e.g. "Grade 10" or "UKG". Classes persist across academic years;
 * their sections and strength are configured per year. `displayOrder` is the school's progression
 * order (LKG before Grade 1), used for sorting and, later, for promotion.
 *
 * Each class is backed by a `class` unit in the organization hierarchy (`unitId`) so roles can be
 * scoped to it ("Grade 10 coordinator"). That unit is managed from here, not from the hierarchy.
 */
const classSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 16 },
    description: { type: String, trim: true, maxlength: 500 },
    displayOrder: { type: Number, required: true, default: 0 },
    /** Strength used for new sections unless a capacity is given. */
    defaultSectionCapacity: { type: Number, required: true, min: 1, max: MAX_SECTION_CAPACITY, default: DEFAULT_SECTION_CAPACITY },
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    unitId: { type: Types.ObjectId, ref: 'OrganizationUnit', required: true },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'classes' },
);

classSchema.index({ organizationId: 1, code: 1 }, { unique: true });
classSchema.index({ organizationId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
classSchema.index({ organizationId: 1, displayOrder: 1 });
classSchema.index({ unitId: 1 }, { unique: true });

export type SchoolClass = InferSchemaType<typeof classSchema>;
export type SchoolClassDocument = HydratedDocument<SchoolClass>;
export const SchoolClassModel = model('SchoolClass', classSchema);

export function toPublicClass<E extends Record<string, unknown> = Record<never, never>>(c: SchoolClass & { _id: unknown }, extra: E = {} as E) {
  return {
    id: String(c._id),
    organizationId: String(c.organizationId),
    name: c.name,
    code: c.code,
    description: c.description ?? null,
    displayOrder: c.displayOrder,
    defaultSectionCapacity: c.defaultSectionCapacity,
    status: c.status,
    unitId: String(c.unitId),
    ...extra,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
