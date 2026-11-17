import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ACADEMIC_YEAR_STATUSES = ['planned', 'active', 'completed', 'archived'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

/**
 * Academic year lifecycle. Exactly one year per school can be `active` (the current year); it is
 * enforced by a partial unique index so concurrent activations can't both win.
 *
 *   planned ──activate──▶ active ──close──▶ completed ──archive──▶ archived
 *      │                    ▲                  │  ▲                  │
 *      └──archive──▶ archived   └────reopen────┘  └────unarchive─────┘
 *
 * Completed and archived years are read-only history: their sections can't be edited and their
 * hierarchy units are inactive, so scopes over last year's sections stop granting access.
 */
export const ACADEMIC_YEAR_TRANSITIONS: Record<AcademicYearStatus, readonly AcademicYearStatus[]> = {
  planned: ['active', 'archived'],
  active: ['completed'],
  completed: ['active', 'archived'],
  archived: ['completed'],
};

/** Years whose structure (sections, terms) may still change. */
export const EDITABLE_YEAR_STATUSES: readonly AcademicYearStatus[] = ['planned', 'active'];

const termSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { _id: true },
);

const academicYearSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    /** Short code embedded in section unit codes (e.g. G10-A-2026-27). */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ACADEMIC_YEAR_STATUSES, required: true, default: 'planned' },
    terms: { type: [termSchema], default: [] },
    activatedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'academic_years' },
);

academicYearSchema.index({ organizationId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
academicYearSchema.index({ organizationId: 1, code: 1 }, { unique: true });
academicYearSchema.index({ organizationId: 1, startDate: 1 });
// One current year per school.
academicYearSchema.index({ organizationId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_year_per_org' });

export type AcademicYear = InferSchemaType<typeof academicYearSchema>;
export type AcademicYearDocument = HydratedDocument<AcademicYear>;
export const AcademicYearModel = model('AcademicYear', academicYearSchema);

const day = (d: Date) => d.toISOString().slice(0, 10);

export function toPublicAcademicYear<E extends Record<string, unknown> = Record<never, never>>(y: AcademicYear & { _id: unknown }, extra: E = {} as E) {
  return {
    id: String(y._id),
    organizationId: String(y.organizationId),
    name: y.name,
    code: y.code,
    startDate: day(y.startDate),
    endDate: day(y.endDate),
    status: y.status,
    isCurrent: y.status === 'active',
    terms: (y.terms ?? []).map((t) => ({ id: String((t as { _id?: unknown })._id), name: t.name, startDate: day(t.startDate), endDate: day(t.endDate) })),
    activatedAt: y.activatedAt ?? null,
    completedAt: y.completedAt ?? null,
    ...extra,
    createdAt: y.createdAt,
    updatedAt: y.updatedAt,
  };
}
