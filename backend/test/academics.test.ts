import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addMember, app, bearer, createActiveSchool, superAdminToken, webLogin } from './helpers.js';
import { OrganizationUnitModel } from '../src/modules/organization-units/organization-unit.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { PERMISSION_CATALOG } from '../src/modules/permissions/permission.catalog.js';

const v1 = '/api/v1';
type Body = Record<string, unknown>;

async function school() {
  const superToken = await superAdminToken();
  const s = await createActiveSchool(superToken);
  return { ...s, superToken, t: s.adminToken };
}

const get = (t: string, path: string) => request(app).get(`${v1}${path}`).set(bearer(t));
const post = (t: string, path: string, body: Body = {}) => request(app).post(`${v1}${path}`).set(bearer(t)).send(body);
const patch = (t: string, path: string, body: Body) => request(app).patch(`${v1}${path}`).set(bearer(t)).send(body);
const put = (t: string, path: string, body: Body) => request(app).put(`${v1}${path}`).set(bearer(t)).send(body);
const del = (t: string, path: string) => request(app).delete(`${v1}${path}`).set(bearer(t));

async function ok<T = Body>(res: request.Test | Promise<request.Response>, status = 200): Promise<T> {
  const r = await res;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as T;
}

const year = (t: string, body: Body = {}) =>
  ok<{ id: string; code: string; status: string }>(post(t, '/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', ...body }), 201);
const klass = (t: string, body: Body = {}) =>
  ok<{ id: string; unitId: string; displayOrder: number }>(post(t, '/classes', { name: 'Grade 10', code: 'G10', ...body }), 201);
const section = (t: string, body: Body) => ok<{ id: string; unitId: string; capacity: number; code: string }>(post(t, '/sections', body), 201);
const activate = (t: string, id: string, closeCurrent?: boolean) => patch(t, `/academic-years/${id}/status`, { status: 'active', closeCurrent });

async function memberToken(email: string, organizationId: string) {
  const { accessToken } = await webLogin(email);
  await request(app).post(`${v1}/me/active-organization`).set(bearer(accessToken)).send({ organizationId }).expect(200);
  return accessToken;
}

/** Adds `email` to the school with a fresh role holding `permissions`, and returns their token. */
async function withRole(s: Awaited<ReturnType<typeof school>>, email: string, permissions: unknown[]) {
  const { user } = await addMember(s.t, email);
  const role = await ok<{ id: string }>(post(s.t, '/roles', { name: `Role ${Math.random().toString(36).slice(2, 7)}`, permissions }), 201);
  await ok(post(s.t, `/users/${user.id}/roles`, { roleId: role.id }));
  return { userId: user.id, token: await memberToken(email, s.organizationId) };
}

// ---------------------------------------------------------------------------

describe('permission catalog', () => {
  it('registers the academic permissions in their own module', async () => {
    const codes = PERMISSION_CATALOG.filter((p) => p.module === 'academics').map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining(['academic_years.read', 'academic_years.create', 'academic_years.update', 'academic_years.delete', 'classes.read', 'classes.create', 'classes.update', 'classes.delete', 'sections.create', 'sections.update', 'sections.delete']),
    );
    expect(PERMISSION_CATALOG.find((p) => p.code === 'sections.update')?.scopedResource).toBe('section');
    const s = await school();
    const modules = await ok<{ code: string }[]>(get(s.t, '/permissions/modules'));
    expect(modules.map((m) => m.code)).toContain('academics');
  });
});

describe('academic years', () => {
  it('creates a planned year with a derived code and terms in date order', async () => {
    const s = await school();
    const y = await ok<Body>(
      post(s.t, '/academic-years', {
        name: 'AY 2026/27',
        startDate: '2026-06-01',
        endDate: '2027-03-31',
        terms: [
          { name: 'Term 2', startDate: '2026-10-15', endDate: '2027-03-31' },
          { name: 'Term 1', startDate: '2026-06-01', endDate: '2026-10-14' },
        ],
      }),
      201,
    );
    expect(y).toMatchObject({ name: 'AY 2026/27', code: 'AY-2026-27', status: 'planned', isCurrent: false, startDate: '2026-06-01', endDate: '2027-03-31', sectionCount: 0 });
    expect((y.terms as { name: string }[]).map((t) => t.name)).toEqual(['Term 1', 'Term 2']);

    const list = await ok<Body[]>(get(s.t, '/academic-years'));
    expect(list).toHaveLength(1);
    expect(await ok(get(s.t, '/academic-years/current'))).toBeNull();
    expect(await AuditLogModel.countDocuments({ action: 'academic_year.created' })).toBe(1);
  });

  it('validates dates and terms', async () => {
    const s = await school();
    const bad = (body: Body) => post(s.t, '/academic-years', { name: 'Bad', startDate: '2026-06-01', endDate: '2027-03-31', ...body });
    expect((await bad({ endDate: '2026-05-01' })).status).toBe(400);
    expect((await bad({ endDate: '2029-03-31' })).status).toBe(400);
    expect((await bad({ startDate: '01/06/2026' })).status).toBe(400);
    expect((await bad({ terms: [{ name: 'T1', startDate: '2026-05-01', endDate: '2026-09-01' }] })).status).toBe(400);
    const overlap = await bad({
      terms: [
        { name: 'T1', startDate: '2026-06-01', endDate: '2026-10-15' },
        { name: 'T2', startDate: '2026-10-15', endDate: '2027-03-31' },
      ],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.message).toMatch(/overlap/);
    const dupNames = await bad({
      terms: [
        { name: 'Term', startDate: '2026-06-01', endDate: '2026-09-01' },
        { name: 'term', startDate: '2026-10-01', endDate: '2027-01-01' },
      ],
    });
    expect(dupNames.status).toBe(400);
    expect((await ok<Body[]>(get(s.t, '/academic-years'))).length).toBe(0);
  });

  it('rejects duplicate names (case-insensitive) and overlapping years', async () => {
    const s = await school();
    await year(s.t);
    expect((await post(s.t, '/academic-years', { name: '2026-27', startDate: '2030-06-01', endDate: '2031-03-31', code: 'X1' })).status).toBe(409);
    const clash = await post(s.t, '/academic-years', { name: '2027-28', startDate: '2027-03-01', endDate: '2028-02-28' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.reason).toBe('years_overlap');
    await year(s.t, { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' });
  });

  it('runs the lifecycle: one current year, explicit hand-over, reopen and archive', async () => {
    const s = await school();
    const y1 = await year(s.t, { name: '2025-26', startDate: '2025-06-01', endDate: '2026-03-31' });
    const y2 = await year(s.t);

    // planned → completed is not a valid move.
    expect((await patch(s.t, `/academic-years/${y1.id}/status`, { status: 'completed' })).status).toBe(409);

    expect(await ok(activate(s.t, y1.id))).toMatchObject({ status: 'active', isCurrent: true });
    expect((await ok<Body>(get(s.t, '/organizations/me'))).settings).toMatchObject({ academicYear: '2025-26' });
    expect(await ok(get(s.t, '/academic-years/current'))).toMatchObject({ id: y1.id });

    // A second year can't silently take over.
    const refused = await activate(s.t, y2.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toMatchObject({ reason: 'another_year_active', academicYearId: y1.id });

    await ok(activate(s.t, y2.id, true));
    expect(await ok(get(s.t, `/academic-years/${y1.id}`))).toMatchObject({ status: 'completed', isCurrent: false });
    expect((await ok<Body>(get(s.t, '/organizations/me'))).settings).toMatchObject({ academicYear: '2026-27' });

    // Reopening needs the current year closed first.
    expect((await activate(s.t, y1.id)).status).toBe(409);
    await ok(patch(s.t, `/academic-years/${y2.id}/status`, { status: 'completed' }));
    expect((await ok<Body>(get(s.t, '/organizations/me'))).settings).not.toHaveProperty('academicYear');
    await ok(activate(s.t, y1.id));

    await ok(patch(s.t, `/academic-years/${y2.id}/status`, { status: 'archived' }));
    expect((await patch(s.t, `/academic-years/${y2.id}/status`, { status: 'active' })).status).toBe(409);
    await ok(patch(s.t, `/academic-years/${y2.id}/status`, { status: 'completed' }));

    expect((await ok<{ status: string }[]>(get(s.t, '/academic-years?status=active'))).map((y) => y.status)).toEqual(['active']);
  });

  it('edits planned and current years but treats completed ones as read-only', async () => {
    const s = await school();
    const y = await year(s.t, { terms: [{ name: 'Term 1', startDate: '2026-06-01', endDate: '2026-10-01' }] });
    // Shrinking the year so the term falls outside is refused.
    expect((await patch(s.t, `/academic-years/${y.id}`, { startDate: '2026-07-01' })).status).toBe(400);
    const edited = await ok<Body>(patch(s.t, `/academic-years/${y.id}`, { endDate: '2027-04-30', terms: [] }));
    expect(edited).toMatchObject({ endDate: '2027-04-30', terms: [] });

    await ok(activate(s.t, y.id));
    await ok(patch(s.t, `/academic-years/${y.id}`, { name: '2026-2027' }));
    await ok(patch(s.t, `/academic-years/${y.id}/status`, { status: 'completed' }));
    const locked = await patch(s.t, `/academic-years/${y.id}`, { name: 'Changed' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.details.reason).toBe('year_locked');
  });

  it('deletes unused years with their sections, but never the current one or one in use', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const sec = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });

    // Someone placed in one of its sections blocks deletion.
    const { user } = await addMember(s.t, 'kid@school.test');
    await ok(post(s.t, `/organization-units/${sec.unitId}/members`, { userId: user.id }));

    await ok(activate(s.t, y.id));
    expect((await del(s.t, `/academic-years/${y.id}`)).status).toBe(409);
    await ok(patch(s.t, `/academic-years/${y.id}/status`, { status: 'completed' }));

    const inUse = await del(s.t, `/academic-years/${y.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.details).toMatchObject({ reason: 'in_use', members: 1 });

    await ok(del(s.t, `/organization-units/${sec.unitId}/members/${user.id}`));
    await ok(del(s.t, `/academic-years/${y.id}`));
    expect(await OrganizationUnitModel.exists({ _id: sec.unitId })).toBeNull();
    expect((await get(s.t, `/sections/${sec.id}`)).status).toBe(404);
  });
});

describe('classes', () => {
  it('creates classes backed by managed class units, in progression order', async () => {
    const s = await school();
    const g1 = await klass(s.t, { name: 'Grade 1', code: 'G1', defaultSectionCapacity: 30 });
    const g2 = await klass(s.t, { name: 'Grade 2', code: 'g2' });
    expect([g1.displayOrder, g2.displayOrder]).toEqual([1, 2]);

    const unit = await OrganizationUnitModel.findById(g1.unitId).lean();
    expect(unit).toMatchObject({ type: 'class', code: 'G1', name: 'Grade 1', depth: 1, managedBy: 'academics' });

    const list = await ok<{ academicYear: unknown; items: Body[] }>(get(s.t, '/classes'));
    expect(list.academicYear).toBeNull();
    expect(list.items.map((c) => [c.code, c.defaultSectionCapacity, c.sectionCount])).toEqual([
      ['G1', 30, 0],
      ['G2', 40, 0],
    ]);
  });

  it('rejects duplicates and bad codes', async () => {
    const s = await school();
    await klass(s.t);
    expect((await post(s.t, '/classes', { name: 'Grade X', code: 'G10' })).status).toBe(409);
    expect((await post(s.t, '/classes', { name: 'grade 10', code: 'GX' })).status).toBe(409);
    expect((await post(s.t, '/classes', { name: 'Grade 11', code: 'G 11' })).status).toBe(400);
    expect((await post(s.t, '/classes', { name: 'Grade 11', code: 'G11', defaultSectionCapacity: 0 })).status).toBe(400);
    expect((await post(s.t, '/classes', { name: 'Grade 11', code: 'G11', defaultSectionCapacity: 501 })).status).toBe(400);
  });

  it('bulk-creates from a template, all or nothing', async () => {
    const s = await school();
    const created = await ok<{ code: string; displayOrder: number }[]>(
      post(s.t, '/classes/bulk', { classes: ['LKG', 'UKG', 'G1', 'G2'].map((code) => ({ name: code, code })) }),
      201,
    );
    expect(created.map((c) => [c.code, c.displayOrder])).toEqual([
      ['LKG', 1],
      ['UKG', 2],
      ['G1', 3],
      ['G2', 4],
    ]);
    // Duplicate inside the payload.
    expect((await post(s.t, '/classes/bulk', { classes: [{ name: 'G3', code: 'G3' }, { name: 'G3 again', code: 'G3' }] })).status).toBe(400);
    // One clash with an existing class: nothing is created.
    expect((await post(s.t, '/classes/bulk', { classes: [{ name: 'G3', code: 'G3' }, { name: 'G1', code: 'G1X' }] })).status).toBe(409);
    expect((await ok<{ items: unknown[] }>(get(s.t, '/classes'))).items).toHaveLength(4);
  });

  it("adopts a hand-made class unit with the same code, but won't take a non-class unit's code", async () => {
    const s = await school();
    const handMade = await ok<{ id: string }>(post(s.t, '/organization-units', { name: 'Tenth', code: 'G10', type: 'class' }), 201);
    const { user } = await addMember(s.t, 'teacher@school.test');
    await ok(post(s.t, `/organization-units/${handMade.id}/members`, { userId: user.id }));

    const c = await klass(s.t);
    expect(c.unitId).toBe(handMade.id);
    expect(await OrganizationUnitModel.findById(handMade.id).lean()).toMatchObject({ name: 'Grade 10', managedBy: 'academics' });
    expect(await MembershipModel.exists({ userId: user.id, organizationUnitIds: handMade.id })).not.toBeNull();

    await ok(post(s.t, '/organization-units', { name: 'Finance', code: 'FIN', type: 'department' }), 201);
    const clash = await post(s.t, '/classes', { name: 'Finance class', code: 'FIN' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.reason).toBe('unit_code_taken');
  });

  it('propagates renames and status to its units and sections', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    expect(await OrganizationUnitModel.findById(a.unitId).lean()).toMatchObject({ code: 'G10-A-2026-27', name: 'Grade 10 A (2026-27)', status: 'active', parentId: expect.anything() });

    await ok(patch(s.t, `/classes/${c.id}`, { name: 'Class X', code: 'X' }));
    expect(await OrganizationUnitModel.findById(c.unitId).lean()).toMatchObject({ name: 'Class X', code: 'X' });
    expect(await OrganizationUnitModel.findById(a.unitId).lean()).toMatchObject({ name: 'Class X A (2026-27)', code: 'X-A-2026-27' });

    await ok(patch(s.t, `/classes/${c.id}`, { status: 'inactive' }));
    expect((await OrganizationUnitModel.findById(c.unitId).lean())!.status).toBe('inactive');
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.status).toBe('inactive');
    const blocked = await post(s.t, '/sections', { academicYearId: y.id, classId: c.id, name: 'B' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details.reason).toBe('class_inactive');

    await ok(patch(s.t, `/classes/${c.id}`, { status: 'active' }));
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.status).toBe('active');
  });

  it('reorders only with the complete list of classes', async () => {
    const s = await school();
    const ids = (await ok<{ id: string }[]>(post(s.t, '/classes/bulk', { classes: ['A1', 'B1', 'C1'].map((code) => ({ name: code, code })) }), 201)).map((c) => c.id);
    expect((await put(s.t, '/classes/order', { classIds: [ids[0], ids[1]] })).status).toBe(400);
    expect((await put(s.t, '/classes/order', { classIds: [ids[0], ids[0], ids[1]] })).status).toBe(400);
    const reordered = await ok<{ id: string; displayOrder: number }[]>(put(s.t, '/classes/order', { classIds: [ids[2], ids[0], ids[1]] }));
    expect(reordered.map((c) => c.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('deletes only classes without sections', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const sec = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const refused = await del(s.t, `/classes/${c.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toMatchObject({ reason: 'has_sections', sections: 1 });
    await ok(del(s.t, `/sections/${sec.id}`));
    await ok(del(s.t, `/classes/${c.id}`));
    expect(await OrganizationUnitModel.exists({ _id: c.unitId })).toBeNull();
    expect((await get(s.t, `/classes/${c.id}`)).status).toBe(404);
  });
});

describe('sections and strength', () => {
  it('creates sections with class default or explicit strength and reports totals', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t, { defaultSectionCapacity: 35 });
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const b = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'B', capacity: 42, room: 'Room 12' });
    expect([a.capacity, b.capacity]).toEqual([35, 42]);

    const detail = await ok<{ sectionCount: number; totalCapacity: number; sections: { name: string; room: string | null }[]; academicYear: { id: string } }>(get(s.t, `/classes/${c.id}?academicYearId=${y.id}`));
    expect(detail).toMatchObject({ sectionCount: 2, totalCapacity: 77, academicYear: { id: y.id } });
    expect(detail.sections.map((x) => [x.name, x.room])).toEqual([
      ['A', null],
      ['B', 'Room 12'],
    ]);
    // Without a year, the planned year is used until one is current.
    expect((await ok<{ academicYear: { id: string } }>(get(s.t, '/classes'))).academicYear.id).toBe(y.id);
  });

  it('keeps section names and codes unique per class and year', async () => {
    const s = await school();
    const y = await year(s.t);
    const y2 = await year(s.t, { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' });
    const g10 = await klass(s.t);
    const g9 = await klass(s.t, { name: 'Grade 9', code: 'G9' });
    await section(s.t, { academicYearId: y.id, classId: g10.id, name: 'A' });
    expect((await post(s.t, '/sections', { academicYearId: y.id, classId: g10.id, name: 'a' })).status).toBe(409);
    expect((await post(s.t, '/sections', { academicYearId: y.id, classId: g10.id, name: 'Alpha', code: 'A' })).status).toBe(409);
    await section(s.t, { academicYearId: y.id, classId: g9.id, name: 'A' });
    await section(s.t, { academicYearId: y2.id, classId: g10.id, name: 'A' });
    expect((await post(s.t, '/sections', { academicYearId: y.id, classId: g10.id, name: 'B', capacity: 0 })).status).toBe(400);
    expect((await post(s.t, '/sections', { academicYearId: y.id, classId: g10.id, name: 'B', capacity: 501 })).status).toBe(400);
  });

  it('bulk-sets the number of sections per class, adding only what is missing', async () => {
    const s = await school();
    const y = await year(s.t);
    const [g1, g2] = await ok<{ id: string }[]>(post(s.t, '/classes/bulk', { classes: [{ name: 'Grade 1', code: 'G1' }, { name: 'Grade 2', code: 'G2', defaultSectionCapacity: 30 }] }), 201);

    const first = await ok<{ created: { name: string; capacity: number; class: { code: string } }[]; skipped: unknown[] }>(
      post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: g1!.id, sectionCount: 3, capacity: 35 }, { classId: g2!.id, sectionCount: 2 }] }),
      201,
    );
    expect(first.created.map((x) => `${x.class.code}${x.name}:${x.capacity}`)).toEqual(['G1A:35', 'G1B:35', 'G1C:35', 'G2A:30', 'G2B:30']);

    // Re-running with a higher count only adds the difference; enough is skipped.
    const second = await ok<{ created: { name: string }[]; skipped: { classId: string; existing: number }[] }>(
      post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: g1!.id, sectionCount: 4 }, { classId: g2!.id, sectionCount: 2 }] }),
      201,
    );
    expect(second.created.map((x) => x.name)).toEqual(['D']);
    expect(second.skipped).toEqual([{ classId: g2!.id, existing: 2 }]);

    const numeric = await ok<{ created: { name: string }[] }>(
      post(s.t, '/sections/bulk', { academicYearId: y.id, naming: 'numeric', items: [{ classId: g2!.id, sectionCount: 4 }] }),
      201,
    );
    expect(numeric.created.map((x) => x.name)).toEqual(['1', '2']);
    expect((await post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: g1!.id, sectionCount: 5 }, { classId: g1!.id, sectionCount: 6 }] })).status).toBe(400);
  });

  it('edits strength, room, name and status', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    await section(s.t, { academicYearId: y.id, classId: c.id, name: 'B' });
    expect(await ok(patch(s.t, `/sections/${a.id}`, { capacity: 45, room: 'Lab 1' }))).toMatchObject({ capacity: 45, room: 'Lab 1' });
    expect((await patch(s.t, `/sections/${a.id}`, { name: 'B' })).status).toBe(409);
    await ok(patch(s.t, `/sections/${a.id}`, { name: 'Rose', code: 'ROSE' }));
    expect(await OrganizationUnitModel.findById(a.unitId).lean()).toMatchObject({ code: 'G10-ROSE-2026-27', name: 'Grade 10 Rose (2026-27)' });
    await ok(patch(s.t, `/sections/${a.id}`, { status: 'inactive', room: null }));
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.status).toBe('inactive');
    expect(await ok<Body[]>(get(s.t, `/sections?academicYearId=${y.id}&status=active`))).toHaveLength(1);
  });

  it('assigns, replaces and clears the class teacher through the hierarchy', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const t1 = (await addMember(s.t, 'teacher1@school.test')).user.id;
    const t2 = (await addMember(s.t, 'teacher2@school.test')).user.id;

    const assigned = await ok<{ classTeacher: { id: string; email: string }; memberCount: number }>(put(s.t, `/sections/${a.id}/class-teacher`, { userId: t1 }));
    expect(assigned).toMatchObject({ classTeacher: { id: t1, email: 'teacher1@school.test' }, memberCount: 1 });
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.headUserIds.map(String)).toEqual([t1]);

    await ok(put(s.t, `/sections/${a.id}/class-teacher`, { userId: t2 }));
    const unit = (await OrganizationUnitModel.findById(a.unitId).lean())!;
    expect(unit.headUserIds.map(String)).toEqual([t2]);
    // The previous teacher stays placed in the section, just no longer as its head.
    expect(await MembershipModel.exists({ userId: t1, organizationUnitIds: a.unitId })).not.toBeNull();

    const overview = await ok<{ totals: { sectionsWithoutClassTeacher: number } }>(get(s.t, `/academics/overview?academicYearId=${y.id}`));
    expect(overview.totals.sectionsWithoutClassTeacher).toBe(0);

    expect(await ok(put(s.t, `/sections/${a.id}/class-teacher`, { userId: null }))).toMatchObject({ classTeacher: null, classTeacherUserId: null });
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.headUserIds).toEqual([]);
  });

  it('refuses class teachers who are not usable members, and self-assignment', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const t = (await addMember(s.t, 'suspended@school.test')).user.id;
    await ok(patch(s.t, `/users/${t}/status`, { status: 'suspended' }));
    expect((await put(s.t, `/sections/${a.id}/class-teacher`, { userId: t })).status).toBe(400);
    expect((await put(s.t, `/sections/${a.id}/class-teacher`, { userId: '0123456789abcdef01234567' })).status).toBe(404);
    const me = (await ok<{ userId: string }>(get(s.t, '/users/me/access-context'))).userId;
    expect((await put(s.t, `/sections/${a.id}/class-teacher`, { userId: me })).status).toBe(403);
  });

  it('deletes a section only when nobody is placed in it', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const t = (await addMember(s.t, 'teacher@school.test')).user.id;
    await ok(put(s.t, `/sections/${a.id}/class-teacher`, { userId: t }));
    const refused = await del(s.t, `/sections/${a.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toMatchObject({ reason: 'in_use', members: 1 });

    await ok(put(s.t, `/sections/${a.id}/class-teacher`, { userId: null }));
    await ok(del(s.t, `/organization-units/${a.unitId}/members/${t}`));
    await ok(del(s.t, `/sections/${a.id}`));
    expect(await OrganizationUnitModel.exists({ _id: a.unitId })).toBeNull();
  });

  it('locks the structure of a completed year and deactivates its section units', async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    await ok(activate(s.t, y.id));
    await ok(patch(s.t, `/academic-years/${y.id}/status`, { status: 'completed' }));

    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.status).toBe('inactive');
    for (const res of [
      await post(s.t, '/sections', { academicYearId: y.id, classId: c.id, name: 'B' }),
      await patch(s.t, `/sections/${a.id}`, { capacity: 10 }),
      await del(s.t, `/sections/${a.id}`),
      await post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: c.id, sectionCount: 3 }] }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('year_locked');
    }

    // Reopening brings the units back.
    await ok(activate(s.t, y.id));
    expect((await OrganizationUnitModel.findById(a.unitId).lean())!.status).toBe('active');
  });
});

describe('year rollover', () => {
  it('copies sections and strength from another year, skipping existing and inactive classes', async () => {
    const s = await school();
    const last = await year(s.t, { name: '2025-26', startDate: '2025-06-01', endDate: '2026-03-31' });
    const next = await year(s.t);
    const [g1, g2, g3] = await ok<{ id: string }[]>(post(s.t, '/classes/bulk', { classes: ['G1', 'G2', 'G3'].map((code) => ({ name: code, code })) }), 201);
    await ok(post(s.t, '/sections/bulk', { academicYearId: last.id, items: [{ classId: g1!.id, sectionCount: 2, capacity: 33 }, { classId: g2!.id, sectionCount: 1 }, { classId: g3!.id, sectionCount: 1 }] }), 201);
    await section(s.t, { academicYearId: next.id, classId: g1!.id, name: 'A', capacity: 50 });
    await ok(patch(s.t, `/classes/${g3!.id}`, { status: 'inactive' }));

    const result = await ok<{ created: number; skipped: number }>(post(s.t, `/academic-years/${next.id}/copy-structure`, { sourceAcademicYearId: last.id }), 201);
    expect(result).toMatchObject({ created: 2, skipped: 1 });
    const sections = await ok<{ name: string; capacity: number; class: { code: string } }[]>(get(s.t, `/sections?academicYearId=${next.id}`));
    expect(sections.map((x) => `${x.class.code}${x.name}:${x.capacity}`)).toEqual(['G1A:50', 'G1B:33', 'G2A:40']);

    // Copying again is a no-op.
    expect(await ok(post(s.t, `/academic-years/${next.id}/copy-structure`, { sourceAcademicYearId: last.id }), 201)).toMatchObject({ created: 0 });
    expect((await post(s.t, `/academic-years/${next.id}/copy-structure`, { sourceAcademicYearId: next.id })).status).toBe(400);

    await ok(activate(s.t, last.id));
    await ok(patch(s.t, `/academic-years/${last.id}/status`, { status: 'completed' }));
    expect((await post(s.t, `/academic-years/${last.id}/copy-structure`, { sourceAcademicYearId: next.id })).status).toBe(409);
  });
});

describe('setup overview', () => {
  it('reports totals and a checklist that completes as the school is configured', async () => {
    const s = await school();
    type Overview = { academicYear: { id: string } | null; totals: Record<string, number>; checklist: { key: string; done: boolean }[]; byClass: Body[] };
    const done = (o: Overview) => o.checklist.filter((i) => i.done).map((i) => i.key);

    const empty = await ok<Overview>(get(s.t, '/academics/overview'));
    expect(empty.academicYear).toBeNull();
    expect(done(empty)).toEqual([]);

    const y = await year(s.t);
    const [g1, g2] = await ok<{ id: string }[]>(post(s.t, '/classes/bulk', { classes: [{ name: 'G1', code: 'G1' }, { name: 'G2', code: 'G2' }] }), 201);
    await ok(post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: g1!.id, sectionCount: 2, capacity: 30 }] }), 201);
    let o = await ok<Overview>(get(s.t, '/academics/overview'));
    expect(o.academicYear?.id).toBe(y.id);
    expect(o.totals).toMatchObject({ classes: 2, activeClasses: 2, sections: 2, totalCapacity: 60, averageSectionCapacity: 30, classesWithoutSections: 1, sectionsWithoutClassTeacher: 2 });
    expect(done(o)).toEqual(['academic_year', 'classes']);

    await ok(activate(s.t, y.id));
    await ok(post(s.t, '/sections/bulk', { academicYearId: y.id, items: [{ classId: g2!.id, sectionCount: 1 }] }), 201);
    const sections = await ok<{ id: string }[]>(get(s.t, '/sections'));
    for (const [i, sec] of sections.entries()) {
      const t = (await addMember(s.t, `ct${i}@school.test`)).user.id;
      await ok(put(s.t, `/sections/${sec.id}/class-teacher`, { userId: t }));
    }
    o = await ok<Overview>(get(s.t, '/academics/overview'));
    expect(done(o)).toEqual(['academic_year', 'current_year', 'classes', 'sections', 'class_teachers']);
    expect(o.byClass.map((c) => [c.code, c.sectionCount, c.totalCapacity])).toEqual([
      ['G1', 2, 60],
      ['G2', 1, 40],
    ]);
  });
});

describe('hierarchy integration', () => {
  it("doesn't let the hierarchy API change units owned by classes and sections", async () => {
    const s = await school();
    const y = await year(s.t);
    const c = await klass(s.t);
    const a = await section(s.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const dept = await ok<{ id: string }>(post(s.t, '/organization-units', { name: 'Academic', code: 'ACAD', type: 'academic' }), 201);

    for (const res of [
      await patch(s.t, `/organization-units/${c.unitId}`, { name: 'Hacked' }),
      await patch(s.t, `/organization-units/${a.unitId}`, { status: 'inactive' }),
      await patch(s.t, `/organization-units/${c.unitId}`, { parentId: dept.id }),
      await patch(s.t, `/organization-units/${dept.id}`, { parentId: c.unitId }),
      await del(s.t, `/organization-units/${a.unitId}`),
      await post(s.t, '/organization-units', { name: 'Z', code: 'Z', type: 'section', parentId: c.unitId }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('managed_unit');
    }
    const unit = await ok<{ managedBy: string }>(get(s.t, `/organization-units/${a.unitId}`));
    expect(unit.managedBy).toBe('academics');

    // Placing people in sections still works there.
    const { user } = await addMember(s.t, 'student@school.test');
    await ok(post(s.t, `/organization-units/${a.unitId}/members`, { userId: user.id }));
    expect((await ok<{ memberCount: number }>(get(s.t, `/sections/${a.id}`))).memberCount).toBe(1);
  });
});

describe('authorization', () => {
  it('requires the academic permissions', async () => {
    const s = await school();
    const y = await year(s.t);
    await addMember(s.t, 'nobody@school.test');
    const nobody = await memberToken('nobody@school.test', s.organizationId);
    for (const res of [
      await get(nobody, '/academic-years'),
      await get(nobody, '/classes'),
      await get(nobody, '/sections'),
      await get(nobody, '/academics/overview'),
      await post(nobody, '/academic-years', { name: 'X', startDate: '2030-01-01', endDate: '2030-12-31' }),
      await post(nobody, '/classes', { name: 'X', code: 'X' }),
      await patch(nobody, `/academic-years/${y.id}/status`, { status: 'active' }),
    ]) {
      expect(res.status).toBe(403);
    }

    const viewer = await withRole(s, 'viewer@school.test', ['classes.read', 'academic_years.read']);
    await ok(get(viewer.token, '/classes'));
    await ok(get(viewer.token, '/academic-years'));
    await ok(get(viewer.token, '/academics/overview'));
    expect((await post(viewer.token, '/classes', { name: 'X', code: 'X' })).status).toBe(403);
    expect((await post(viewer.token, '/sections/bulk', { academicYearId: y.id, items: [] })).status).toBe(403);
  });

  it('limits section edits to the classes and sections in scope', async () => {
    const s = await school();
    const y = await year(s.t);
    const g10 = await klass(s.t);
    const g9 = await klass(s.t, { name: 'Grade 9', code: 'G9' });
    const s10a = await section(s.t, { academicYearId: y.id, classId: g10.id, name: 'A' });
    const s9a = await section(s.t, { academicYearId: y.id, classId: g9.id, name: 'A' });

    // A Grade 10 coordinator: class scope over the class's unit covers its sections.
    const coord = await withRole(s, 'coord@school.test', ['classes.read', { permission: 'sections.update', scopes: [{ type: 'class', resourceIds: [g10.unitId] }] }]);
    await ok(patch(coord.token, `/sections/${s10a.id}`, { capacity: 44 }));
    const out = await patch(coord.token, `/sections/${s9a.id}`, { capacity: 44 });
    expect(out.status).toBe(403);
    expect(out.body.error.details.reason).toBe('out_of_scope');
    // Setting a class teacher also needs organization_units.assign.
    expect((await put(coord.token, `/sections/${s10a.id}/class-teacher`, { userId: coord.userId })).status).toBe(403);

    // Custom scope: exactly one section.
    const one = await withRole(s, 'one@school.test', [{ permission: 'sections.update', scopes: [{ type: 'custom', resourceIds: [s9a.id] }] }]);
    await ok(patch(one.token, `/sections/${s9a.id}`, { room: 'R9' }));
    expect((await patch(one.token, `/sections/${s10a.id}`, { room: 'R9' })).status).toBe(403);

    // Closing the year deactivates section units, so class/section scopes over them stop working.
    await ok(activate(s.t, y.id));
    await ok(patch(s.t, `/academic-years/${y.id}/status`, { status: 'completed' }));
    await ok(activate(s.t, y.id));
    await ok(patch(s.t, `/classes/${g10.id}`, { status: 'inactive' }));
    expect((await patch(coord.token, `/sections/${s10a.id}`, { capacity: 40 })).status).toBe(403);
  });

  it('isolates schools from each other', async () => {
    const a = await school();
    const y = await year(a.t);
    const c = await klass(a.t);
    const sec = await section(a.t, { academicYearId: y.id, classId: c.id, name: 'A' });
    const b = await createActiveSchool(a.superToken);
    for (const res of [
      await get(b.adminToken, `/classes/${c.id}`),
      await get(b.adminToken, `/academic-years/${y.id}`),
      await get(b.adminToken, `/sections/${sec.id}`),
      await patch(b.adminToken, `/sections/${sec.id}`, { capacity: 1 }),
      await patch(b.adminToken, `/classes/${c.id}`, { name: 'Mine' }),
      await del(b.adminToken, `/academic-years/${y.id}`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await post(b.adminToken, '/sections', { academicYearId: y.id, classId: c.id, name: 'B' })).status).toBe(404);
    expect((await ok<{ items: unknown[] }>(get(b.adminToken, '/classes'))).items).toHaveLength(0);
    // Codes are per school.
    await klass(b.adminToken);
    await year(b.adminToken);
  });
});
