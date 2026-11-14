import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addMember, app, bearer, createActiveSchool, PASSWORD, superAdminToken, tokenFromEmail, webLogin } from './helpers.js';
import { RoleModel } from '../src/modules/roles/role.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { PermissionModel } from '../src/modules/permissions/permission.model.js';
import { PERMISSION_CATALOG } from '../src/modules/permissions/permission.catalog.js';

const v1 = '/api/v1';

async function memberToken(email: string, organizationId: string) {
  const { accessToken } = await webLogin(email);
  await request(app).post(`${v1}/me/active-organization`).set(bearer(accessToken)).send({ organizationId }).expect(200);
  return accessToken;
}

async function createRole(token: string, body: Record<string, unknown>) {
  const res = await request(app).post(`${v1}/roles`).set(bearer(token)).send(body);
  return res;
}

/** A school with its admin, plus a member holding a custom role with the given permissions. */
async function schoolWithRoleHolder(permissions: string[], email = 'staff@school.test') {
  const superToken = await superAdminToken();
  const school = await createActiveSchool(superToken);
  const role = (await createRole(school.adminToken, { name: 'Office Staff', permissions }).then((r) => r.body.data)) as { id: string };
  const { user } = await addMember(school.adminToken, email, { roleIds: [role.id] });
  const token = await memberToken(email, school.organizationId);
  return { ...school, superToken, roleId: role.id, holderId: user.id, holderToken: token };
}

describe('permission catalog', () => {
  it('is synced from code and exposed read-only, split by level', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    expect(await PermissionModel.countDocuments({ status: 'active' })).toBe(PERMISSION_CATALOG.length);

    const org = await request(app).get(`${v1}/permissions`).set(bearer(adminToken)).expect(200);
    expect(org.body.data.every((p: { level: string }) => p.level === 'organization')).toBe(true);
    expect(org.body.data.map((p: { code: string }) => p.code)).toContain('users.create');

    const modules = await request(app).get(`${v1}/permissions/modules`).set(bearer(adminToken)).expect(200);
    expect(modules.body.data.map((m: { code: string }) => m.code)).toEqual(['users', 'roles', 'organization_units', 'settings', 'audit_logs']);

    const platform = await request(app).get(`${v1}/platform/permissions`).set(bearer(superToken)).expect(200);
    expect(platform.body.data.every((p: { level: string }) => p.level === 'platform')).toBe(true);

    // No write API exists for the catalog.
    await request(app).post(`${v1}/permissions`).set(bearer(adminToken)).send({ code: 'x.y' }).expect(404);
  });

  it('rejects unknown, invented and platform permissions on organization roles', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    for (const perm of ['students.read', 'anything.goes', 'organizations.create']) {
      const res = await createRole(adminToken, { name: `Role ${perm}`, permissions: [perm] });
      expect(res.status).toBe(400);
      expect(res.body.error.details.permissions).toEqual([perm]);
    }
  });
});

describe('custom organization roles', () => {
  it('grant exactly their permissions, and changes apply immediately', async () => {
    const s = await schoolWithRoleHolder(['users.read', 'users.create', 'invitations.create']);

    await request(app).get(`${v1}/users`).set(bearer(s.holderToken)).expect(200);
    await request(app).post(`${v1}/users`).set(bearer(s.holderToken)).send({ firstName: 'N', lastName: 'P', email: 'np@school.test' }).expect(201);
    const denied = await request(app).delete(`${v1}/users/${s.holderId}`).set(bearer(s.holderToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toEqual({ requiredPermission: 'users.delete' });
    await request(app).get(`${v1}/roles`).set(bearer(s.holderToken)).expect(403);

    const ctx = await request(app).get(`${v1}/users/me/access-context`).set(bearer(s.holderToken)).expect(200);
    expect(ctx.body.data.organization).toMatchObject({ usable: true, allPermissions: false, roles: [{ name: 'Office Staff' }] });
    expect(ctx.body.data.organization.permissions.sort()).toEqual(['invitations.create', 'users.create', 'users.read']);
    expect(ctx.body.data.platform.permissions).toEqual([]);

    const eff = await request(app).get(`${v1}/users/${s.holderId}/permissions`).set(bearer(s.adminToken)).expect(200);
    expect(eff.body.data).toMatchObject({ effective: true, allPermissions: false });
    expect(eff.body.data.permissions).toHaveLength(3);

    // Removing a permission from the role takes effect on the very next request.
    await request(app).delete(`${v1}/roles/${s.roleId}/permissions/users.read`).set(bearer(s.adminToken)).expect(200);
    await request(app).get(`${v1}/users`).set(bearer(s.holderToken)).expect(403);

    // Deactivating the role removes everything it granted.
    await request(app).patch(`${v1}/roles/${s.roleId}/status`).set(bearer(s.adminToken)).send({ status: 'inactive' }).expect(200);
    await request(app).post(`${v1}/users`).set(bearer(s.holderToken)).send({ firstName: 'Q', lastName: 'R', email: 'qr@school.test' }).expect(403);
  });

  it('unions permissions across multiple roles', async () => {
    const s = await schoolWithRoleHolder(['users.read']);
    const second = (await createRole(s.adminToken, { name: 'Auditor', permissions: ['audit_logs.read'] })).body.data;
    await request(app).post(`${v1}/users/${s.holderId}/roles`).set(bearer(s.adminToken)).send({ roleId: second.id }).expect(200);
    await request(app).get(`${v1}/users`).set(bearer(s.holderToken)).expect(200);
    await request(app).get(`${v1}/audit-logs`).set(bearer(s.holderToken)).expect(200);
    const roles = await request(app).get(`${v1}/users/${s.holderId}/roles`).set(bearer(s.adminToken)).expect(200);
    expect(roles.body.data.map((r: { name: string }) => r.name).sort()).toEqual(['Auditor', 'Office Staff']);
  });

  it('a role named "Super Admin" grants nothing', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    expect((await createRole(adminToken, { name: 'Anything', code: 'super_admin' })).status).toBe(400);
    expect((await createRole(adminToken, { name: 'School Admin', code: 'school_admin' })).status).toBe(400);

    const fake = (await createRole(adminToken, { name: 'Super Admin', code: 'totally_super' })).body.data;
    await addMember(adminToken, 'fake@school.test', { roleIds: [fake.id] });
    const token = await memberToken('fake@school.test', organizationId);
    await request(app).get(`${v1}/users`).set(bearer(token)).expect(403);
    await request(app).get(`${v1}/platform/organizations`).set(bearer(token)).expect(403);
    const me = await request(app).get(`${v1}/auth/me`).set(bearer(token)).expect(200);
    expect(me.body.data.isSuperAdmin).toBe(false);
  });

  it('supports clone, update, and deleting only unused roles', async () => {
    const s = await schoolWithRoleHolder(['users.read', 'invitations.read']);
    const clone = await request(app).post(`${v1}/roles/${s.roleId}/clone`).set(bearer(s.adminToken)).send({ name: 'Office Staff (copy)' }).expect(201);
    expect(clone.body.data.permissions.map((p: { code: string }) => p.code).sort()).toEqual(['invitations.read', 'users.read']);
    expect(clone.body.data.code).toBe('office_staff_copy');

    const updated = await request(app).patch(`${v1}/roles/${clone.body.data.id}`).set(bearer(s.adminToken)).send({ name: 'Front Desk', permissions: ['users.read'] }).expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Front Desk', permissions: [{ code: 'users.read', scopes: [{ type: 'organization' }] }] });

    const inUse = await request(app).delete(`${v1}/roles/${s.roleId}`).set(bearer(s.adminToken));
    expect(inUse.status).toBe(409);
    const holders = await request(app).get(`${v1}/roles/${s.roleId}/users`).set(bearer(s.adminToken)).expect(200);
    expect(holders.body.data.items.map((u: { id: string }) => u.id)).toEqual([s.holderId]);

    await request(app).delete(`${v1}/users/${s.holderId}/roles/${s.roleId}`).set(bearer(s.adminToken)).expect(200);
    // Nobody holds it now, so it can be deleted.
    await request(app).delete(`${v1}/roles/${s.roleId}`).set(bearer(s.adminToken)).expect(200);
    await request(app).delete(`${v1}/roles/${clone.body.data.id}`).set(bearer(s.adminToken)).expect(200);
  });

  it('protects the School Admin system role', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    const adminRole = (await RoleModel.findOne({ organizationId, code: 'school_admin' }).lean())!;
    const id = String(adminRole._id);
    for (const res of [
      await request(app).patch(`${v1}/roles/${id}`).set(bearer(adminToken)).send({ name: 'Renamed' }),
      await request(app).delete(`${v1}/roles/${id}`).set(bearer(adminToken)),
      await request(app).patch(`${v1}/roles/${id}/status`).set(bearer(adminToken)).send({ status: 'inactive' }),
      await request(app).post(`${v1}/roles/${id}/permissions`).set(bearer(adminToken)).send({ permissions: ['users.read'] }),
    ]) {
      expect(res.body.error.code).toBe('ROLE_PROTECTED');
    }
    const role = await request(app).get(`${v1}/roles/${id}`).set(bearer(adminToken)).expect(200);
    expect(role.body.data).toMatchObject({ allPermissions: true, isProtected: true, userCount: 1 });
  });

  it('keeps roles inside their tenant', async () => {
    const superToken = await superAdminToken();
    const a = await createActiveSchool(superToken);
    const b = await createActiveSchool(superToken);
    const bRole = (await createRole(b.adminToken, { name: 'B Role', permissions: ['users.read'] })).body.data;
    const { user } = await addMember(a.adminToken, 'a-member@school.test');

    await request(app).get(`${v1}/roles/${bRole.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).patch(`${v1}/roles/${bRole.id}`).set(bearer(a.adminToken)).send({ name: 'Renamed' }).expect(404);
    await request(app).post(`${v1}/users/${user.id}/roles`).set(bearer(a.adminToken)).send({ roleId: bRole.id }).expect(400);
    const list = await request(app).get(`${v1}/roles`).set(bearer(a.adminToken)).expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(bRole.id);
  });
});

describe('privilege escalation', () => {
  const HR = ['users.read', 'users.create', 'users.update', 'roles.read', 'roles.create', 'roles.update', 'roles.assign', 'invitations.create'];

  it('you cannot grant permissions you do not hold', async () => {
    const s = await schoolWithRoleHolder(HR, 'hr@school.test');

    // Create a role with a permission HR lacks.
    const res = await createRole(s.holderToken, { name: 'Remover', permissions: ['users.delete'] });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ reason: 'privilege_escalation', missingPermissions: ['users.delete'] });

    // Widen your own role.
    const widen = await request(app).post(`${v1}/roles/${s.roleId}/permissions`).set(bearer(s.holderToken)).send({ permissions: ['audit_logs.read'] });
    expect(widen.body.error.details.reason).toBe('privilege_escalation');

    // Hand out School Admin (it grants everything).
    const adminRoleId = String((await RoleModel.findOne({ organizationId: s.organizationId, code: 'school_admin' }).lean())!._id);
    const { user: teacher } = await addMember(s.adminToken, 'teacher@school.test');
    const give = await request(app).post(`${v1}/users/${teacher.id}/roles`).set(bearer(s.holderToken)).send({ roleId: adminRoleId });
    expect(give.body.error.details.reason).toBe('privilege_escalation');
    const invite = await request(app).post(`${v1}/users`).set(bearer(s.holderToken)).send({ firstName: 'A', lastName: 'B', email: 'ab@school.test', roleIds: [adminRoleId] });
    expect(invite.body.error.details.reason).toBe('privilege_escalation');
    expect(await UserModel.exists({ normalizedEmail: 'ab@school.test' })).toBeNull();

    // Within their own permissions, all of this is allowed.
    const ok = (await createRole(s.holderToken, { name: 'Viewer', permissions: ['users.read'] }).then((r) => r.body.data)) as { id: string };
    await request(app).post(`${v1}/users/${teacher.id}/roles`).set(bearer(s.holderToken)).send({ roleId: ok.id }).expect(200);
  });

  it('you cannot change your own roles', async () => {
    const s = await schoolWithRoleHolder(HR, 'hr@school.test');
    const extra = (await createRole(s.holderToken, { name: 'Viewer', permissions: ['users.read'] })).body.data;
    const self = await request(app).post(`${v1}/users/${s.holderId}/roles`).set(bearer(s.holderToken)).send({ roleId: extra.id });
    expect(self.status).toBe(403);
    await request(app).delete(`${v1}/users/${s.holderId}/roles/${s.roleId}`).set(bearer(s.holderToken)).expect(403);
  });

  it('you cannot act on someone more privileged than you', async () => {
    const s = await schoolWithRoleHolder(HR, 'hr@school.test');
    const admin = (await UserModel.findOne({ normalizedEmail: s.adminEmail }).lean())!;
    const res = await request(app).patch(`${v1}/users/${admin._id}/status`).set(bearer(s.holderToken)).send({ status: 'suspended' });
    expect(res.status).toBe(403);
    expect(res.body.error.details.reason).toBe('privilege_escalation');
    // Nor edit or demote a role that grants more than you have.
    const adminRoleId = String((await RoleModel.findOne({ organizationId: s.organizationId, code: 'school_admin' }).lean())!._id);
    await request(app).delete(`${v1}/users/${admin._id}/roles/${adminRoleId}`).set(bearer(s.holderToken)).expect(403);
    const powerful = (await createRole(s.adminToken, { name: 'Powerful', permissions: ['users.delete', 'users.read'] })).body.data;
    const edit = await request(app).patch(`${v1}/roles/${powerful.id}`).set(bearer(s.holderToken)).send({ name: 'Weakened' });
    expect(edit.body.error.details.reason).toBe('privilege_escalation');
  });

  it('membership role changes need roles.assign and follow the same rules', async () => {
    const s = await schoolWithRoleHolder(['memberships.update', 'memberships.read', 'users.read']);
    const { membership } = await addMember(s.adminToken, 'teacher@school.test');
    const role = (await createRole(s.adminToken, { name: 'Viewer', permissions: ['users.read'] })).body.data;
    const res = await request(app).patch(`${v1}/memberships/${membership.id}`).set(bearer(s.holderToken)).send({ roleIds: [role.id] });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual({ requiredPermission: 'roles.assign' });
  });
});

describe('platform staff', () => {
  async function setupStaff(superToken: string, permissions: string[], email = 'staff@lekho.com') {
    const role = await request(app).post(`${v1}/platform/roles`).set(bearer(superToken)).send({ name: `Staff ${email}`, permissions }).expect(201);
    await request(app)
      .post(`${v1}/platform/users`)
      .set(bearer(superToken))
      .send({ firstName: 'Pat', lastName: 'Staff', email, roleIds: [role.body.data.id] })
      .expect(201);
    const token = await tokenFromEmail(email, '/set-password');
    await request(app).post(`${v1}/auth/reset-password`).send({ token, password: PASSWORD }).expect(200);
    const { accessToken } = await webLogin(email);
    const user = (await UserModel.findOne({ normalizedEmail: email }).lean())!;
    return { token: accessToken, roleId: role.body.data.id as string, userId: String(user._id) };
  }

  it('an onboarding executive can onboard schools but nothing else', async () => {
    const superToken = await superAdminToken();
    const staff = await setupStaff(superToken, ['organizations.read', 'organizations.create', 'organizations.assign']);

    const org = await request(app)
      .post(`${v1}/platform/organizations`)
      .set(bearer(staff.token))
      .send({ name: 'Staff School', slug: 'staff-school', code: 'STF', contact: { email: 'o@s.test' } })
      .expect(201);
    await request(app).post(`${v1}/platform/organizations/${org.body.data.id}/admin`).set(bearer(staff.token)).send({ firstName: 'A', lastName: 'B', email: 'a@s.test' }).expect(201);

    const status = await request(app).patch(`${v1}/platform/organizations/${org.body.data.id}/status`).set(bearer(staff.token)).send({ status: 'archived' });
    expect(status.body.error.details).toEqual({ requiredPermission: 'organizations.manage' });
    await request(app).get(`${v1}/platform/users`).set(bearer(staff.token)).expect(403);
    await request(app).get(`${v1}/platform/audit-logs`).set(bearer(staff.token)).expect(403);

    const ctx = await request(app).get(`${v1}/users/me/access-context`).set(bearer(staff.token)).expect(200);
    expect(ctx.body.data).toMatchObject({ isSuperAdmin: false, organization: null });
    expect(ctx.body.data.platform.permissions.sort()).toEqual(['organizations.assign', 'organizations.create', 'organizations.read']);
  });

  it('staff cannot elevate themselves, out-grant themselves, or touch the Super Admin', async () => {
    const superToken = await superAdminToken();
    const lead = await setupStaff(superToken, ['platform_users.read', 'platform_users.create', 'platform_users.update', 'platform_roles.read', 'platform_roles.create', 'platform_roles.update']);

    const big = await request(app).post(`${v1}/platform/roles`).set(bearer(superToken)).send({ name: 'Everything', permissions: ['organizations.manage', 'platform_audit.read'] }).expect(201);
    const self = await request(app).patch(`${v1}/platform/users/${lead.userId}`).set(bearer(lead.token)).send({ roleIds: [lead.roleId, big.body.data.id] });
    expect(self.status).toBe(403);
    const widen = await request(app).post(`${v1}/platform/roles/${lead.roleId}/permissions`).set(bearer(lead.token)).send({ permissions: ['organizations.manage'] });
    expect(widen.body.error.details.reason).toBe('privilege_escalation');
    const newRole = await request(app).post(`${v1}/platform/roles`).set(bearer(lead.token)).send({ name: 'Mine', permissions: ['platform_audit.read'] });
    expect(newRole.body.error.details.reason).toBe('privilege_escalation');

    const asSuper = await request(app).post(`${v1}/platform/users`).set(bearer(lead.token)).send({ firstName: 'L', lastName: 'O', email: 'owner@lekho.com', roleIds: [] });
    expect(asSuper.body.error.code).toBe('ROLE_PROTECTED');

    // Organization roles can't confer platform access.
    const { adminToken } = await createActiveSchool(superToken);
    await request(app).get(`${v1}/platform/organizations`).set(bearer(adminToken)).expect(403);
  });

  it('suspending platform staff removes access immediately', async () => {
    const superToken = await superAdminToken();
    const staff = await setupStaff(superToken, ['organizations.read']);
    await request(app).get(`${v1}/platform/organizations`).set(bearer(staff.token)).expect(200);
    await request(app).patch(`${v1}/platform/users/${staff.userId}`).set(bearer(superToken)).send({ status: 'suspended' }).expect(200);
    await request(app).get(`${v1}/platform/organizations`).set(bearer(staff.token)).expect(403);
    const list = await request(app).get(`${v1}/platform/users`).set(bearer(superToken)).expect(200);
    expect(list.body.data.items[0]).toMatchObject({ email: 'staff@lekho.com', platformMembership: { status: 'suspended' } });
  });
});

describe('authorization check endpoint', () => {
  it('explains decisions for the caller', async () => {
    const s = await schoolWithRoleHolder(['users.read']);
    const check = (body: Record<string, unknown>) => request(app).post(`${v1}/authorization/check`).set(bearer(s.holderToken)).send(body).expect(200);

    expect((await check({ permission: 'users.read' })).body.data).toMatchObject({
      allowed: true,
      reason: 'role_permission',
      matchedPermissions: ['users.read'],
      scope: 'organization',
    });
    expect((await check({ permission: 'users.delete' })).body.data).toEqual({ allowed: false, reason: 'permission_not_granted' });
    expect((await check({ permission: 'made.up' })).body.data).toEqual({ allowed: false, reason: 'unknown_permission' });
    expect((await check({ permission: 'organizations.read' })).body.data).toEqual({ allowed: false, reason: 'permission_not_granted' });

    const superCheck = await request(app).post(`${v1}/authorization/check`).set(bearer(s.superToken)).send({ permission: 'organizations.manage' }).expect(200);
    expect(superCheck.body.data).toMatchObject({ allowed: true, reason: 'super_admin' });
    // Platform authority doesn't extend into schools.
    const superInSchool = await request(app).post(`${v1}/authorization/check`).set(bearer(s.superToken)).send({ permission: 'users.read', organizationId: s.organizationId }).expect(200);
    expect(superInSchool.body.data).toEqual({ allowed: false, reason: 'not_a_member' });
  });
});

describe('audit log APIs', () => {
  it('are scoped to the organization, filterable and exportable', async () => {
    const superToken = await superAdminToken();
    const a = await createActiveSchool(superToken);
    const b = await createActiveSchool(superToken);
    await createRole(a.adminToken, { name: 'Clerk', permissions: ['users.read'] });

    const list = await request(app).get(`${v1}/audit-logs?action=role.`).set(bearer(a.adminToken)).expect(200);
    expect(list.body.data.items.map((l: { action: string }) => l.action)).toEqual(['role.created']);
    const all = await request(app).get(`${v1}/audit-logs?limit=100`).set(bearer(a.adminToken)).expect(200);
    expect(all.body.data.items.every((l: { organizationId: string }) => l.organizationId === a.organizationId)).toBe(true);

    const bLogs = await request(app).get(`${v1}/audit-logs`).set(bearer(b.adminToken)).expect(200);
    await request(app).get(`${v1}/audit-logs/${bLogs.body.data.items[0].id}`).set(bearer(a.adminToken)).expect(404);

    const csv = await request(app).get(`${v1}/audit-logs/export`).set(bearer(a.adminToken)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toBe('createdAt,actorId,organizationId,action,resource,resourceId,result,ipAddress,details');
    expect(csv.text).toContain('"role.created"');

    const platform = await request(app).get(`${v1}/platform/audit-logs?limit=100`).set(bearer(superToken)).expect(200);
    const orgIds = new Set(platform.body.data.items.map((l: { organizationId: string | null }) => l.organizationId));
    expect(orgIds.has(a.organizationId) && orgIds.has(b.organizationId)).toBe(true);
  });
});
