import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { MAX_SECTION_CAPACITY } from './class.model.js';

/**
 * A section of a class in one academic year ("10 A, 2026-27"), with its sanctioned strength
 * (`capacity`), room and class teacher. Backed by a `section` unit under the class's unit, so
 * section-scoped roles work and the class teacher is that unit's head.
 */
const sectionSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    academicYearId: { type: Types.ObjectId, ref: 'AcademicYear', required: true },
    classId: { type: Types.ObjectId, ref: 'SchoolClass', required: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 10 },
    capacity: { type: Number, required: true, min: 1, max: MAX_SECTION_CAPACITY },
    room: { type: String, trim: true, maxlength: 60 },
    classTeacherUserId: { type: Types.ObjectId, ref: 'User' },
    displayOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    unitId: { type: Types.ObjectId, ref: 'OrganizationUnit', required: true },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'sections' },
);

sectionSchema.index({ organizationId: 1, academicYearId: 1, classId: 1, code: 1 }, { unique: true });
sectionSchema.index({ organizationId: 1, academicYearId: 1, classId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
sectionSchema.index({ unitId: 1 }, { unique: true });
sectionSchema.index({ organizationId: 1, classTeacherUserId: 1 });

export type Section = InferSchemaType<typeof sectionSchema>;
export type SectionDocument = HydratedDocument<Section>;
export const SectionModel = model('Section', sectionSchema);

export function toPublicSection<E extends Record<string, unknown> = Record<never, never>>(s: Section & { _id: unknown }, extra: E = {} as E) {
  return {
    id: String(s._id),
    organizationId: String(s.organizationId),
    academicYearId: String(s.academicYearId),
    classId: String(s.classId),
    name: s.name,
    code: s.code,
    capacity: s.capacity,
    room: s.room ?? null,
    classTeacherUserId: s.classTeacherUserId ? String(s.classTeacherUserId) : null,
    displayOrder: s.displayOrder,
    status: s.status,
    unitId: String(s.unitId),
    ...extra,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
