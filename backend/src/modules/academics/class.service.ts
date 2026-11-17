import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { academicUnits } from './academic-units.js';
import { audit, findClass, resolveYear, yearSummary } from './academics.shared.js';
import { SchoolClassModel, toPublicClass, type SchoolClass } from './class.model.js';
import { SectionModel } from './section.model.js';
import { sectionService } from './section.service.js';

export interface ClassInput {
  name: string;
  code: string;
  description?: string;
  displayOrder?: number;
  defaultSectionCapacity?: number;
}

export interface ClassUpdate {
  name?: string;
  code?: string;
  description?: string | null;
  displayOrder?: number;
  defaultSectionCapacity?: number;
  status?: 'active' | 'inactive';
}

type ClassDoc = SchoolClass & { _id: Types.ObjectId };

/** Section totals per class for one year (active sections only). */
async function yearStats(organizationId: string, yearId: Types.ObjectId | null, classIds: Types.ObjectId[]) {
  if (!yearId || classIds.length === 0) return new Map<string, { sectionCount: number; totalCapacity: number; sectionsWithoutClassTeacher: number }>();
  const rows = await SectionModel.aggregate<{ _id: Types.ObjectId; sections: number; capacity: number; noTeacher: number }>([
    { $match: { organizationId: new Types.ObjectId(organizationId), academicYearId: yearId, classId: { $in: classIds }, status: 'active' } },
    {
      $group: {
        _id: '$classId',
        sections: { $sum: 1 },
        capacity: { $sum: '$capacity' },
        noTeacher: { $sum: { $cond: [{ $ifNull: ['$classTeacherUserId', false] }, 0, 1] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { sectionCount: r.sections, totalCapacity: r.capacity, sectionsWithoutClassTeacher: r.noTeacher }]));
}

const EMPTY = { sectionCount: 0, totalCapacity: 0, sectionsWithoutClassTeacher: 0 };
const snapshot = (c: SchoolClass) => ({ name: c.name, code: c.code, displayOrder: c.displayOrder, defaultSectionCapacity: c.defaultSectionCapacity, status: c.status });

async function assertUnique(organizationId: string, name: string, code: string, exceptId?: Types.ObjectId) {
  const except = exceptId ? { _id: { $ne: exceptId } } : {};
  if (await SchoolClassModel.exists({ organizationId, code, ...except })) throw ApiError.conflict(`A class with code ${code} already exists.`, { code: ['Already used'] });
  if (await SchoolClassModel.exists({ organizationId, name, ...except }).collation({ locale: 'en', strength: 2 })) {
    throw ApiError.conflict(`A class called ${name} already exists.`, { name: ['Already used'] });
  }
}

async function nextDisplayOrder(organizationId: string) {
  const last = await SchoolClassModel.findOne({ organizationId }, { displayOrder: 1 }).sort({ displayOrder: -1 }).lean();
  return (last?.displayOrder ?? 0) + 1;
}

export const classService = {
  /** Classes in progression order, with section totals for the given (or current) year. */
  async list(organizationId: string, filter: { status?: 'active' | 'inactive'; academicYearId?: string } = {}) {
    const year = await resolveYear(organizationId, filter.academicYearId);
    const classes = (await SchoolClassModel.find({ organizationId, ...(filter.status && { status: filter.status }) }).sort({ displayOrder: 1, name: 1 }).lean()) as ClassDoc[];
    const stats = await yearStats(organizationId, year?._id ?? null, classes.map((c) => c._id));
    return {
      academicYear: yearSummary(year),
      items: classes.map((c) => toPublicClass(c, stats.get(String(c._id)) ?? EMPTY)),
    };
  },

  async get(organizationId: string, id: string, academicYearId?: string) {
    const cls = await findClass(organizationId, id);
    const year = await resolveYear(organizationId, academicYearId);
    const [stats, sections, totalSectionsAllYears] = await Promise.all([
      yearStats(organizationId, year?._id ?? null, [cls._id]),
      year ? sectionService.list(organizationId, { academicYearId: String(year._id), classId: id }) : Promise.resolve([]),
      SectionModel.countDocuments({ organizationId, classId: cls._id }),
    ]);
    return {
      ...toPublicClass(cls.toObject(), stats.get(id) ?? EMPTY),
      academicYear: yearSummary(year),
      sections,
      totalSectionsAllYears,
    };
  },

  async create(ctx: OrgActor, input: ClassInput) {
    const [created] = await this.createMany(ctx, [input]);
    return created!;
  },

  /** Creates several classes at once (e.g. from a "Grade 1–12" template). All or nothing. */
  async createMany(ctx: OrgActor, inputs: ClassInput[]) {
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const i of inputs) {
      if (codes.has(i.code)) throw ApiError.badRequest(`The code ${i.code} appears twice.`, { code: ['Duplicate in this list'] });
      if (names.has(i.name.toLowerCase())) throw ApiError.badRequest(`The name ${i.name} appears twice.`, { name: ['Duplicate in this list'] });
      codes.add(i.code);
      names.add(i.name.toLowerCase());
      await assertUnique(ctx.organizationId, i.name, i.code);
    }
    let order = await nextDisplayOrder(ctx.organizationId);
    const created = await inTransaction(async (session) => {
      const out: ClassDoc[] = [];
      for (const i of inputs) {
        const unit = await academicUnits.createForClass(session, { organizationId: ctx.organizationId, name: i.name, code: i.code, actorId: ctx.actorId });
        const [cls] = await SchoolClassModel.create(
          [
            {
              organizationId: ctx.organizationId,
              name: i.name,
              code: i.code,
              description: i.description,
              displayOrder: i.displayOrder ?? order++,
              defaultSectionCapacity: i.defaultSectionCapacity,
              unitId: unit._id,
              createdBy: ctx.actorId,
            },
          ],
          { session },
        );
        out.push(cls!.toObject() as ClassDoc);
      }
      return out;
    });
    for (const c of created) await audit(ctx, 'class.created', String(c._id), { after: snapshot(c) });
    return created.map((c) => toPublicClass(c, EMPTY));
  },

  /**
   * Edits a class. Name and code changes flow to its unit and every section unit (whose names and
   * codes include the class's). Deactivating a class deactivates its units too, so scopes over
   * it and its sections stop granting access; reactivating restores them.
   */
  async update(ctx: OrgActor, id: string, input: ClassUpdate) {
    const cls = await findClass(ctx.organizationId, id);
    const before = snapshot(cls);
    const name = input.name ?? cls.name;
    const code = input.code ?? cls.code;
    if (name !== cls.name || code !== cls.code) await assertUnique(ctx.organizationId, name, code, cls._id);

    cls.name = name;
    cls.code = code;
    if (input.description !== undefined) cls.description = input.description ?? undefined;
    if (input.displayOrder !== undefined) cls.displayOrder = input.displayOrder;
    if (input.defaultSectionCapacity !== undefined) cls.defaultSectionCapacity = input.defaultSectionCapacity;
    if (input.status !== undefined) cls.status = input.status;

    await inTransaction(async (session) => {
      await cls.save({ session });
      if (before.name !== name || before.code !== code) await academicUnits.rename(session, ctx.organizationId, cls.unitId, { name, code });
      if (before.status !== cls.status) await academicUnits.setClassUnitStatus(session, ctx.organizationId, cls.unitId, cls.status === 'active');
      if (before.name !== name || before.code !== code || before.status !== cls.status) {
        await academicUnits.resyncSections(session, ctx.organizationId, { classId: cls._id });
      }
    });
    await audit(ctx, before.status !== cls.status ? 'class.status_changed' : 'class.updated', id, { before, after: snapshot(cls) });
    return this.get(ctx.organizationId, id);
  },

  /** Sets the progression order. `classIds` must list every class in the school exactly once. */
  async reorder(ctx: OrgActor, classIds: string[]) {
    const all = await SchoolClassModel.find({ organizationId: ctx.organizationId }, { _id: 1 }).lean();
    const known = new Set(all.map((c) => String(c._id)));
    if (new Set(classIds).size !== classIds.length || classIds.length !== known.size || !classIds.every((id) => known.has(id))) {
      throw ApiError.badRequest('List every class exactly once, in the new order.');
    }
    await SchoolClassModel.bulkWrite(classIds.map((id, i) => ({ updateOne: { filter: { _id: id, organizationId: ctx.organizationId }, update: { $set: { displayOrder: i + 1 } } } })));
    await audit(ctx, 'class.reordered', undefined, { after: { order: classIds } });
    return (await this.list(ctx.organizationId)).items;
  },

  /**
   * Deletes a class that has never had sections in any year, and whose unit nobody is placed in.
   * Classes with history should be deactivated instead.
   */
  async remove(ctx: OrgActor, id: string) {
    const cls = await findClass(ctx.organizationId, id);
    const sections = await SectionModel.countDocuments({ organizationId: ctx.organizationId, classId: cls._id });
    if (sections) {
      throw ApiError.conflict(`${cls.name} has ${sections} section${sections === 1 ? '' : 's'} across academic years. Delete them first, or deactivate the class instead.`, {
        reason: 'has_sections',
        sections,
      });
    }
    await academicUnits.assertDeletable(ctx.organizationId, [cls.unitId], 'class');
    await inTransaction(async (session) => {
      await cls.deleteOne({ session });
      await academicUnits.remove(session, ctx.organizationId, [cls.unitId]);
    });
    await audit(ctx, 'class.deleted', id, { before: snapshot(cls) });
  },
};
