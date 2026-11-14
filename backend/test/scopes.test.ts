import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addMember, app, bearer, createActiveSchool, superAdminToken, webLogin } from './helpers.js';
import { OrganizationUnitModel } from '../src/modules/organization-units/organization-unit.model.js';

const v1 = '/api/v1';
type Ids = Record<string, string>;

async function memberToken(email: string, organizationId: string) {
  const { accessToken } = await webLogin(email);
  await request(app).post(`${v1}/me/active-organization`).set(bearer(accessToken)).send({ organizationId }).expect(200);
  return accessToken;
}

async function unit(token: string, body: Record<string, unknown>) {
  const res = await request(app).post(`${v1}/organization-units`).set(bearer(token)).send(body);
  if (res.status !== 201) throw new Error(`unit create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

async function place(token: string, unitId: string, userId: string, head = false) {
  await request(app).post(`${v1}/organization-units/${unitId}/members`).set(bearer(token)).send({ userId, head }).expect(200);
}

async function role(token: string, name: string, permissions: unknown[]) {
  const res = await request(app).post(`${v1}/roles`).set(bearer(token)).send({ name, permissions });
  if (res.status !== 201) throw new Error(`role create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

/**
 * ABC School
 * ├── Academic (academic)
 * │   ├── Mathematics (department)   ← mathTeacher, mathHead (head)
 * │   └── Science (department)       ← sciTeacher
 * ├── Finance (department)           ← accountant
 * ├── Grade 10 (class)
 * │   ├── 10A (section)              ← student10a, mathTeacher
 * │   └── 10B (section)              ← student10b
 * └── Grade 9 (class)
 *     └── 9A (section)               ← student9a
 */
async function school() {
  const superToken = await superAdminToken();
  const s = await createActiveSchool(superToken);
  const t = s.adminToken;
  const u: Ids = {};
  u.academic = await unit(t, { name: 'Academic', code: 'ACAD', type: 'academic' });
  u.math = await unit(t, { name: 'Mathematics', code: 'MATH', type: 'department', parentId: u.academic });
  u.science = await unit(t, { name: 'Science', code: 'SCI', type: 'department', parentId: u.academic });
  u.finance = await unit(t, { name: 'Finance', code: 'FIN', type: 'department' });
  u.g10 = await unit(t, { name: 'Grade 10', code: 'G10', type: 'class' });
  u.s10a = await unit(t, { name: '10A', code: '10A', type: 'section', parentId: u.g10 });
  u.s10b = await unit(t, { name: '10B', code: '10B', type: 'section', parentId: u.g10 });
  u.g9 = await unit(t, { name: 'Grade 9', code: 'G9', type: 'class' });
  u.s9a = await unit(t, { name: '9A', code: '9A', type: 'section', parentId: u.g9 });

  const people: Ids = {};
  for (const name of ['mathTeacher', 'mathHead', 'sciTeacher', 'accountant', 'student10a', 'student10b', 'student9a']) {
    people[name] = (await addMember(t, `${name.toLowerCase()}@school.test`)).user.id;
  }
  await place(t, u.math, people.mathTeacher!);
  await place(t, u.s10a, people.mathTeacher!);
  await place(t, u.math, people.mathHead!, true);
  await place(t, u.science, people.sciTeacher!);
  await place(t, u.finance, people.accountant!);
  await place(t, u.s10a, people.student10a!);
  await place(t, u.s10b, people.student10b!);
  await place(t, u.s9a, people.student9a!);
  return { ...s, superToken, u, people };
}

/** Gives `person` a role and returns their token. */
async function holder(s: Awaited<ReturnType<typeof school>>, person: string, permissions: unknown[]) {
  const roleId = await role(s.adminToken, `Role for ${person} ${Math.random().toString(36).slice(2, 6)}`, permissions);
  await request(app).post(`${v1}/users/${s.people[person]}/roles`).set(bearer(s.adminToken)).send({ roleId }).expect(200);
  return { token: await memberToken(`${person.toLowerCase()}@school.test`, s.organizationId), roleId };
}

const visibleIds = async (token: string) =>
  ((await request(app).get(`${v1}/users?limit=100`).set(bearer(token)).expect(200)).body.data.items as { id: string }[]).map((x) => x.id).sort();

describe('organizational hierarchy', () => {
  it('builds a tree with materialized paths and member counts', async () => {
    const s = await school();
    const tree = (await request(app).get(`${v1}/organization-units/tree`).set(bearer(s.adminToken)).expect(200)).body.data;
    expect(tree.map((n: { name: string }) => n.name)).toEqual(['Academic', 'Finance', 'Grade 10', 'Grade 9']);
    const academic = tree.find((n: { name: string }) => n.name === 'Academic');
    expect(academic.children.map((c: { name: string; memberCount: number }) => [c.name, c.memberCount])).toEqual([
      ['Mathematics', 2],
      ['Science', 1],
    ]);
    const s10a = await OrganizationUnitModel.findById(s.u.s10a).lean();
    expect(s10a).toMatchObject({ depth: 2, ancestors: [expect.anything()] });
    expect(String(s10a!.ancestors[0])).toBe(s.u.g10);

    const hierarchy = await request(app).get(`${v1}/organizations/${s.organizationId}/hierarchy`).set(bearer(s.adminToken)).expect(200);
    expect(hierarchy.body.data).toHaveLength(4);

    const math = (await request(app).get(`${v1}/organization-units/${s.u.math}`).set(bearer(s.adminToken)).expect(200)).body.data;
    expect(math).toMatchObject({ memberCount: 2, heads: [{ email: 'mathhead@school.test' }] });

    // Department filter on the user list includes sub-units.
    const academicUsers = await request(app).get(`${v1}/users?unitId=${s.u.academic}`).set(bearer(s.adminToken)).expect(200);
    expect(academicUsers.body.data.items.map((x: { id: string }) => x.id).sort()).toEqual(
      [s.people.mathTeacher, s.people.mathHead, s.people.sciTeacher].sort(),
    );
  });

  it('enforces structure rules and depth', async () => {
    const s = await school();
    const t = s.adminToken;
    const bad = (body: Record<string, unknown>) => request(app).post(`${v1}/organization-units`).set(bearer(t)).send(body);
    expect((await bad({ name: 'Orphan', code: 'ORPH', type: 'section' })).status).toBe(400);
    expect((await bad({ name: 'Bad', code: 'BAD', type: 'section', parentId: s.u.math })).status).toBe(400);
    expect((await bad({ name: 'Under section', code: 'US', type: 'custom', parentId: s.u.s10a })).status).toBe(400);
    expect((await bad({ name: 'Dup', code: 'math', type: 'department' })).status).toBe(409);

    await request(app).patch(`${v1}/organizations/${s.organizationId}/settings`).set(bearer(t)).send({ hierarchyMaxDepth: 2 }).expect(200);
    const tooDeep = await bad({ name: 'Algebra', code: 'ALG', type: 'custom', parentId: s.u.math });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.error.message).toMatch(/2 levels/);
  });

  it('moves subtrees, rejects cycles, and deletes only empty units', async () => {
    const s = await school();
    const t = s.adminToken;
    await request(app).patch(`${v1}/organizations/${s.organizationId}/settings`).set(bearer(t)).send({ hierarchyMaxDepth: 5 }).expect(200);
    const physics = await unit(t, { name: 'Physics', code: 'PHY', type: 'custom', parentId: s.u.science });

    await request(app).patch(`${v1}/organization-units/${s.u.science}`).set(bearer(t)).send({ parentId: s.u.finance }).expect(200);
    const moved = (await OrganizationUnitModel.findById(physics).lean())!;
    expect(moved.ancestors.map(String)).toEqual([s.u.finance, s.u.science]);
    expect(moved.depth).toBe(3);

    expect((await request(app).patch(`${v1}/organization-units/${s.u.science}`).set(bearer(t)).send({ parentId: physics })).status).toBe(400);
    expect((await request(app).patch(`${v1}/organization-units/${s.u.academic}`).set(bearer(t)).send({ parentId: s.u.academic })).status).toBe(400);

    const notEmpty = await request(app).delete(`${v1}/organization-units/${s.u.finance}`).set(bearer(t));
    expect(notEmpty.status).toBe(409);
    expect(notEmpty.body.error.details).toMatchObject({ childUnits: 1, members: 1 });

    await request(app).delete(`${v1}/organization-units/${physics}`).set(bearer(t)).expect(200);
    // A unit referenced by a role scope can't be deleted either.
    const empty = await unit(t, { name: 'Library', code: 'LIB', type: 'department' });
    await role(t, 'Librarian', [{ permission: 'users.read', scopes: [{ type: 'department', resourceIds: [empty] }] }]);
    expect((await request(app).delete(`${v1}/organization-units/${empty}`).set(bearer(t))).body.error.details).toMatchObject({ rolesReferencing: 1 });
  });

  it('is isolated per tenant', async () => {
    const s = await school();
    const other = await createActiveSchool(s.superToken);
    await request(app).get(`${v1}/organization-units/${s.u.math}`).set(bearer(other.adminToken)).expect(404);
    await request(app).patch(`${v1}/organization-units/${s.u.math}`).set(bearer(other.adminToken)).send({ name: 'Pwned' }).expect(404);
    await request(app).post(`${v1}/organization-units/${s.u.math}/members`).set(bearer(other.adminToken)).send({ userId: s.people.mathTeacher }).expect(404);
    const tree = await request(app).get(`${v1}/organization-units/tree`).set(bearer(other.adminToken)).expect(200);
    expect(tree.body.data).toEqual([]);
    // A unit of another school can't parent one of ours.
    expect((await request(app).post(`${v1}/organization-units`).set(bearer(other.adminToken)).send({ name: 'X', code: 'X', type: 'custom', parentId: s.u.math })).status).toBe(404);
  });
});

describe('scope evaluation', () => {
  it('department scope (relative): a department head sees and manages only their department', async () => {
    const s = await school();
    const hod = await holder(s, 'mathHead', [
      { permission: 'users.read', scopes: [{ type: 'department' }] },
      { permission: 'organization_units.assign', scopes: [{ type: 'department' }] },
      'organization_units.read',
    ]);

    expect(await visibleIds(hod.token)).toEqual([s.people.mathTeacher, s.people.mathHead].sort());
    await request(app).get(`${v1}/users/${s.people.mathTeacher}`).set(bearer(hod.token)).expect(200);
    const out = await request(app).get(`${v1}/users/${s.people.sciTeacher}`).set(bearer(hod.token));
    expect(out.status).toBe(403);
    expect(out.body.error.details).toEqual({ reason: 'out_of_scope', requiredPermission: 'users.read' });

    // Manage membership of their own unit, not others.
    await place(hod.token, s.u.math, s.people.student9a!);
    const science = await request(app).post(`${v1}/organization-units/${s.u.science}/members`).set(bearer(hod.token)).send({ userId: s.people.student9a });
    expect(science.body.error.details.reason).toBe('out_of_scope');
    // No self-placement.
    await request(app).post(`${v1}/organization-units/${s.u.math}/members`).set(bearer(hod.token)).send({ userId: s.people.mathHead }).expect(403);

    // Deactivating the department removes department-scoped access.
    await request(app).patch(`${v1}/organization-units/${s.u.math}`).set(bearer(s.adminToken)).send({ status: 'inactive' }).expect(200);
    expect(await visibleIds(hod.token)).toEqual([]);
  });

  it('department scope (explicit) covers sub-units', async () => {
    const s = await school();
    const h = await holder(s, 'accountant', [{ permission: 'users.read', scopes: [{ type: 'department', resourceIds: [s.u.math, s.u.science] }] }]);
    expect(await visibleIds(h.token)).toEqual([s.people.mathTeacher, s.people.mathHead, s.people.sciTeacher].sort());
  });

  it('class scope includes the class’s sections; section scope is just the section', async () => {
    const s = await school();
    const coordinator = await holder(s, 'accountant', [{ permission: 'users.read', scopes: [{ type: 'class', resourceIds: [s.u.g10] }] }]);
    expect(await visibleIds(coordinator.token)).toEqual([s.people.student10a, s.people.student10b, s.people.mathTeacher].sort());

    const sectionTeacher = await holder(s, 'sciTeacher', [{ permission: 'users.read', scopes: [{ type: 'section', resourceIds: [s.u.s10b] }] }]);
    expect(await visibleIds(sectionTeacher.token)).toEqual([s.people.student10b]);
  });

  it('class scope (relative) follows the actor’s own class', async () => {
    const s = await school();
    await place(s.adminToken, s.u.g9, s.people.sciTeacher!);
    const t = await holder(s, 'sciTeacher', [{ permission: 'users.read', scopes: [{ type: 'class' }] }]);
    // Grade 9 and its sections: the teacher (now a class member) and 9A's student; not Grade 10.
    expect(await visibleIds(t.token)).toEqual([s.people.sciTeacher, s.people.student9a].sort());
  });

  it('assigned scope: anything in the actor’s units', async () => {
    const s = await school();
    const t = await holder(s, 'mathTeacher', [{ permission: 'users.read', scopes: [{ type: 'assigned' }] }]);
    // Mathematics (mathHead, self) + 10A (student10a, self)
    expect(await visibleIds(t.token)).toEqual([s.people.mathTeacher, s.people.mathHead, s.people.student10a].sort());
  });

  it('own scope: only your own record', async () => {
    const s = await school();
    const t = await holder(s, 'student10a', [
      { permission: 'users.read', scopes: [{ type: 'own' }] },
      { permission: 'users.update', scopes: [{ type: 'own' }] },
    ]);
    expect(await visibleIds(t.token)).toEqual([s.people.student10a]);
    await request(app).patch(`${v1}/users/${s.people.student10a}`).set(bearer(t.token)).send({ phone: '123' }).expect(200);
    const other = await request(app).patch(`${v1}/users/${s.people.student10b}`).set(bearer(t.token)).send({ phone: '123' });
    expect(other.body.error.details.reason).toBe('out_of_scope');
  });

  it('custom scope: exactly the listed resources', async () => {
    const s = await school();
    const t = await holder(s, 'accountant', [{ permission: 'users.read', scopes: [{ type: 'custom', resourceIds: [s.people.student9a] }] }]);
    expect(await visibleIds(t.token)).toEqual([s.people.student9a]);
  });

  it('several scopes on one permission are unioned', async () => {
    const s = await school();
    const t = await holder(s, 'accountant', [
      { permission: 'users.read', scopes: [{ type: 'own' }, { type: 'section', resourceIds: [s.u.s9a] }] },
    ]);
    expect(await visibleIds(t.token)).toEqual([s.people.accountant, s.people.student9a].sort());
  });

  it('applies to memberships too', async () => {
    const s = await school();
    const t = await holder(s, 'accountant', [{ permission: 'memberships.read', scopes: [{ type: 'department' }] }]);
    const list = await request(app).get(`${v1}/memberships`).set(bearer(t.token)).expect(200);
    expect(list.body.data.items.map((m: { userId: string }) => m.userId)).toEqual([s.people.accountant]);
  });

  it('the check endpoint evaluates resource scope', async () => {
    const s = await school();
    const other = await createActiveSchool(s.superToken);
    const foreign = (await addMember(other.adminToken, 'foreign@school.test')).user.id;
    const hod = await holder(s, 'mathHead', [{ permission: 'users.read', scopes: [{ type: 'department' }] }]);
    const check = async (resourceId: string) =>
      (await request(app).post(`${v1}/authorization/check`).set(bearer(hod.token)).send({ permission: 'users.read', resourceType: 'user', resourceId }).expect(200)).body.data;

    expect(await check(s.people.mathTeacher!)).toMatchObject({ allowed: true, scope: 'department' });
    expect(await check(s.people.sciTeacher!)).toEqual({ allowed: false, reason: 'out_of_scope' });
    expect(await check(foreign)).toEqual({ allowed: false, reason: 'not_found' });
    const noResource = (await request(app).post(`${v1}/authorization/check`).set(bearer(hod.token)).send({ permission: 'users.read' }).expect(200)).body.data;
    expect(noResource).toMatchObject({ allowed: true, scope: 'department' });
  });
});

describe('scope configuration', () => {
  it('PUT /roles/:id/scopes replaces scopes and validates them', async () => {
    const s = await school();
    const other = await createActiveSchool(s.superToken);
    const foreign = (await addMember(other.adminToken, 'foreign@school.test')).user.id;
    const roleId = await role(s.adminToken, 'Teacher', ['users.read', 'roles.read']);
    const put = (permissions: unknown) => request(app).put(`${v1}/roles/${roleId}/scopes`).set(bearer(s.adminToken)).send({ permissions });

    const ok = await put([{ permission: 'users.read', scopes: [{ type: 'class', resourceIds: [s.u.g10] }, { type: 'own' }] }]).expect(200);
    expect(ok.body.data.permissions.find((p: { code: string }) => p.code === 'users.read').scopes).toEqual([
      { type: 'class', resourceIds: [s.u.g10] },
      { type: 'own', resourceIds: [] },
    ]);

    expect((await put([{ permission: 'roles.read', scopes: [{ type: 'department' }] }])).status).toBe(400); // not scopable
    expect((await put([{ permission: 'users.read', scopes: [{ type: 'department', resourceIds: [s.u.g10] }] }])).status).toBe(400); // class id as department
    expect((await put([{ permission: 'users.read', scopes: [{ type: 'custom', resourceIds: [foreign] }] }])).status).toBe(400); // other tenant
    expect((await put([{ permission: 'users.delete', scopes: [{ type: 'own' }] }])).status).toBe(400); // not on role
    expect((await put([{ permission: 'users.read', scopes: [{ type: 'platform' }] }])).status).toBe(400);

    // Organization scope collapses everything else.
    const collapsed = await put([{ permission: 'users.read', scopes: [{ type: 'own' }, { type: 'organization' }] }]).expect(200);
    expect(collapsed.body.data.permissions.find((p: { code: string }) => p.code === 'users.read').scopes).toEqual([{ type: 'organization', resourceIds: [] }]);
  });

  it('a scoped administrator cannot grant wider reach than their own', async () => {
    const s = await school();
    const hod = await holder(s, 'mathHead', [
      { permission: 'users.read', scopes: [{ type: 'department' }] },
      'roles.read',
      'roles.create',
      'roles.update',
      'roles.assign',
    ]);
    const create = (permissions: unknown) => request(app).post(`${v1}/roles`).set(bearer(hod.token)).send({ name: `R ${Math.random()}`, permissions });

    const orgWide = await create(['users.read']);
    expect(orgWide.status).toBe(403);
    expect(orgWide.body.error.details).toEqual({ reason: 'privilege_escalation', scopeTooBroad: ['users.read'] });
    expect((await create([{ permission: 'users.read', scopes: [{ type: 'department' }] }])).status).toBe(403); // relative
    expect((await create([{ permission: 'users.read', scopes: [{ type: 'department', resourceIds: [s.u.science] }] }])).status).toBe(403);
    expect((await create([{ permission: 'users.read', scopes: [{ type: 'custom', resourceIds: [s.people.sciTeacher] }] }])).status).toBe(403);

    // Narrower, concrete grants inside their department are fine.
    const ok = await create([{ permission: 'users.read', scopes: [{ type: 'department', resourceIds: [s.u.math] }] }]).expect(201);
    await create([{ permission: 'users.read', scopes: [{ type: 'own' }] }]).expect(201);
    await create([{ permission: 'users.read', scopes: [{ type: 'custom', resourceIds: [s.people.mathTeacher] }] }]).expect(201);
    await request(app).post(`${v1}/users/${s.people.mathTeacher}/roles`).set(bearer(hod.token)).send({ roleId: ok.body.data.id }).expect(200);

    // Nor widen an existing scoped role.
    const widen = await request(app)
      .put(`${v1}/roles/${ok.body.data.id}/scopes`)
      .set(bearer(hod.token))
      .send({ permissions: [{ permission: 'users.read', scopes: [{ type: 'organization' }] }] });
    expect(widen.body.error.details.reason).toBe('privilege_escalation');
  });
});
