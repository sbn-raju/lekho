import { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { RoleModel } from '../roles/role.model.js';
import { OrganizationUnitModel } from '../organization-units/organization-unit.model.js';
import { AcademicYearModel, EDITABLE_YEAR_STATUSES } from './academic-year.model.js';
import { SchoolClassModel } from './class.model.js';
import { SectionModel } from './section.model.js';

/**
 * Keeps the hierarchy units behind classes and sections in step with them. Classes and sections
 * are the source of truth; their units exist so the scope engine (class / section scopes, class
 * teacher as unit head) works on real entities. Units created here carry `managedBy: 'academics'`,
 * which stops the hierarchy API from renaming, moving, deactivating or deleting them.
 */

const MANAGER = 'academics';

export const sectionUnitCode = (classCode: string, sectionCode: string, yearCode: string) => `${classCode}-${sectionCode}-${yearCode}`;
export const sectionUnitName = (className: string, sectionName: string, yearName: string) => `${className} ${sectionName} (${yearName})`;

type Oid = Types.ObjectId;
const oid = (id: string | Oid) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

async function assertCodeFree(organizationId: string, code: string, session: ClientSession, exceptUnitId?: Oid) {
  const clash = await OrganizationUnitModel.findOne({ organizationId, code, ...(exceptUnitId && { _id: { $ne: exceptUnitId } }) }, { name: 1 })
    .session(session)
    .lean();
  if (clash) {
    throw ApiError.conflict(`The hierarchy already has a unit with code ${code} (${clash.name}). Choose a different code.`, { reason: 'unit_code_taken', code });
  }
}

export const academicUnits = {
  /**
   * Creates the class's unit at the top of the hierarchy. A school that already built its classes
   * by hand in the hierarchy keeps them: an unmanaged `class` unit with the same code is adopted,
   * along with its members and any role scopes pointing at it.
   */
  async createForClass(session: ClientSession, input: { organizationId: string; name: string; code: string; actorId: string }) {
    const existing = await OrganizationUnitModel.findOne({ organizationId: input.organizationId, code: input.code }).session(session);
    if (existing) {
      if (existing.type !== 'class' || existing.managedBy) {
        throw ApiError.conflict(`The hierarchy already has a unit with code ${input.code} (${existing.name}). Choose a different code.`, {
          reason: 'unit_code_taken',
          code: input.code,
        });
      }
      existing.managedBy = MANAGER;
      existing.name = input.name;
      existing.status = 'active';
      await existing.save({ session });
      return existing;
    }
    const [unit] = await OrganizationUnitModel.create(
      [{ organizationId: input.organizationId, name: input.name, code: input.code, type: 'class', depth: 1, ancestors: [], managedBy: MANAGER, createdBy: input.actorId }],
      { session },
    );
    return unit!;
  },

  async createForSection(
    session: ClientSession,
    input: { organizationId: string; classUnitId: Oid; name: string; code: string; active: boolean; actorId: string },
  ) {
    const parent = await OrganizationUnitModel.findOne({ _id: input.classUnitId, organizationId: input.organizationId }).session(session).lean();
    if (!parent) throw ApiError.notFound("The class's hierarchy unit is missing.");
    await assertCodeFree(input.organizationId, input.code, session);
    const [unit] = await OrganizationUnitModel.create(
      [
        {
          organizationId: input.organizationId,
          name: input.name,
          code: input.code,
          type: 'section',
          parentId: parent._id,
          ancestors: [...parent.ancestors, parent._id],
          depth: parent.depth + 1,
          status: input.active ? 'active' : 'inactive',
          managedBy: MANAGER,
          createdBy: input.actorId,
        },
      ],
      { session },
    );
    return unit!;
  },

  async rename(session: ClientSession, organizationId: string, unitId: Oid, next: { name: string; code: string }) {
    await assertCodeFree(organizationId, next.code, session, unitId);
    await OrganizationUnitModel.updateOne({ _id: unitId, organizationId }, { $set: { name: next.name, code: next.code } }, { session });
  },

  /**
   * Recomputes section unit names, codes and statuses from their section, class and year. A
   * section's unit is active only while the section and its class are active and its year is
   * planned or current, so last year's class-teacher scopes stop working when the year closes.
   */
  async resyncSections(session: ClientSession, organizationId: string, filter: { classId?: Oid; academicYearId?: Oid; sectionIds?: Oid[] }) {
    const q: Record<string, unknown> = { organizationId };
    if (filter.classId) q.classId = filter.classId;
    if (filter.academicYearId) q.academicYearId = filter.academicYearId;
    if (filter.sectionIds) q._id = { $in: filter.sectionIds };
    const sections = await SectionModel.find(q).session(session).lean();
    if (sections.length === 0) return;
    const [classes, years] = await Promise.all([
      SchoolClassModel.find({ _id: { $in: [...new Set(sections.map((s) => String(s.classId)))].map(oid) } }).session(session).lean(),
      AcademicYearModel.find({ _id: { $in: [...new Set(sections.map((s) => String(s.academicYearId)))].map(oid) } }).session(session).lean(),
    ]);
    const classById = new Map(classes.map((c) => [String(c._id), c]));
    const yearById = new Map(years.map((y) => [String(y._id), y]));
    const updates = sections.flatMap((s) => {
      const c = classById.get(String(s.classId));
      const y = yearById.get(String(s.academicYearId));
      if (!c || !y) return [];
      const active = s.status === 'active' && c.status === 'active' && EDITABLE_YEAR_STATUSES.includes(y.status);
      return [
        {
          updateOne: {
            filter: { _id: s.unitId, organizationId },
            update: {
              $set: {
                name: sectionUnitName(c.name, s.name, y.name),
                code: sectionUnitCode(c.code, s.code, y.code),
                status: active ? 'active' : 'inactive',
              },
            },
          },
        },
      ];
    });
    // Code changes can collide with hand-made units; the unique index rejects those (409).
    if (updates.length) await OrganizationUnitModel.bulkWrite(updates as never, { session });
  },

  async setClassUnitStatus(session: ClientSession, organizationId: string, unitId: Oid, active: boolean) {
    await OrganizationUnitModel.updateOne({ _id: unitId, organizationId }, { $set: { status: active ? 'active' : 'inactive' } }, { session });
  },

  /** What would stop these units from being deleted: people placed in them, role scopes naming them, other units inside them. */
  async usage(organizationId: string, unitIds: Oid[], session?: ClientSession) {
    if (unitIds.length === 0) return { members: 0, rolesReferencing: 0, childUnits: 0 };
    const [members, rolesReferencing, childUnits] = await Promise.all([
      MembershipModel.countDocuments({ organizationId, organizationUnitIds: { $in: unitIds }, status: { $ne: 'revoked' } }).session(session ?? null),
      RoleModel.countDocuments({ organizationId, 'permissions.scopes.resourceIds': { $in: unitIds } }).session(session ?? null),
      OrganizationUnitModel.countDocuments({ organizationId, parentId: { $in: unitIds }, _id: { $nin: unitIds } }).session(session ?? null),
    ]);
    return { members, rolesReferencing, childUnits };
  },

  async assertDeletable(organizationId: string, unitIds: Oid[], what: string, session?: ClientSession) {
    const usage = await this.usage(organizationId, unitIds, session);
    if (usage.members || usage.rolesReferencing || usage.childUnits) {
      const parts = [
        usage.members && `${usage.members} ${usage.members === 1 ? 'person is' : 'people are'} placed in it`,
        usage.rolesReferencing && `${usage.rolesReferencing} role${usage.rolesReferencing === 1 ? '' : 's'} scope${usage.rolesReferencing === 1 ? 's' : ''} to it`,
        usage.childUnits && `${usage.childUnits} other unit${usage.childUnits === 1 ? '' : 's'} sit${usage.childUnits === 1 ? 's' : ''} inside it`,
      ].filter(Boolean);
      throw ApiError.conflict(`This ${what} is still in use: ${parts.join('; ')}.`, { reason: 'in_use', ...usage });
    }
  },

  async remove(session: ClientSession, organizationId: string, unitIds: Oid[]) {
    if (unitIds.length) await OrganizationUnitModel.deleteMany({ organizationId, _id: { $in: unitIds } }, { session });
  },
};
