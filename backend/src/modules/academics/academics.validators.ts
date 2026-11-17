import { z } from 'zod';
import { objectId } from '../../common/utils/pagination.js';
import { ACADEMIC_YEAR_STATUSES } from './academic-year.model.js';
import { MAX_SECTION_CAPACITY } from './class.model.js';

const codeOf = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]+$/, 'Letters, digits, hyphens and underscores only')
    .min(1)
    .max(max);

/** Calendar date "YYYY-MM-DD", stored as UTC midnight. */
const date = z.iso.date('Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00.000Z`));
const capacity = z.coerce.number().int().min(1).max(MAX_SECTION_CAPACITY);
const status = z.enum(['active', 'inactive']);

// ----- Academic years -----

const term = z.object({ name: z.string().trim().min(1).max(60), startDate: date, endDate: date });

export const createYearSchema = z.object({
  name: z.string().trim().min(1).max(40),
  code: codeOf(12).optional(),
  startDate: date,
  endDate: date,
  terms: z.array(term).max(12).optional(),
});

export const updateYearSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    code: codeOf(12).optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    terms: z.array(term).max(12).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const yearStatusSchema = z.object({ status: z.enum(ACADEMIC_YEAR_STATUSES), closeCurrent: z.boolean().optional() });
export const yearListQuery = z.object({ status: z.enum(ACADEMIC_YEAR_STATUSES).optional() });
export const copyStructureSchema = z.object({ sourceAcademicYearId: objectId });

// ----- Classes -----

const classFields = {
  name: z.string().trim().min(1).max(60),
  code: codeOf(16),
  description: z.string().trim().max(500).optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  defaultSectionCapacity: capacity.optional(),
};

export const createClassSchema = z.object(classFields);
export const bulkClassesSchema = z.object({ classes: z.array(z.object(classFields)).min(1).max(50) });
export const updateClassSchema = z
  .object({
    name: classFields.name.optional(),
    code: classFields.code.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    displayOrder: classFields.displayOrder,
    defaultSectionCapacity: capacity.optional(),
    status: status.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const reorderClassesSchema = z.object({ classIds: z.array(objectId).min(1).max(200) });
export const classListQuery = z.object({ status: status.optional(), academicYearId: objectId.optional() });
export const classGetQuery = z.object({ academicYearId: objectId.optional() });

// ----- Sections -----

const sectionName = z.string().trim().min(1).max(30);

export const createSectionSchema = z.object({
  academicYearId: objectId,
  classId: objectId,
  name: sectionName,
  code: codeOf(10).optional(),
  capacity: capacity.optional(),
  room: z.string().trim().max(60).optional(),
});

export const bulkSectionsSchema = z.object({
  academicYearId: objectId,
  naming: z.enum(['alphabetic', 'numeric']).default('alphabetic'),
  items: z
    .array(z.object({ classId: objectId, sectionCount: z.number().int().min(1).max(26), capacity: capacity.optional() }))
    .min(1)
    .max(100),
});

export const updateSectionSchema = z
  .object({
    name: sectionName.optional(),
    code: codeOf(10).optional(),
    capacity: capacity.optional(),
    room: z.string().trim().max(60).nullable().optional(),
    status: status.optional(),
    displayOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const classTeacherSchema = z.object({ userId: objectId.nullable() });
export const sectionListQuery = z.object({ academicYearId: objectId.optional(), classId: objectId.optional(), status: status.optional() });
export const overviewQuery = z.object({ academicYearId: objectId.optional() });
