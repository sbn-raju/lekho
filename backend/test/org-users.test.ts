import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addMember, app, bearer, createActiveSchool, deliverInvitation, PASSWORD, superAdminToken, webLogin } from './helpers.js';
import { InvitationModel } from '../src/modules/invitations/invitation.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { RoleModel } from '../src/modules/roles/role.model.js';
import { UserModel } from '../src/modules/users/user.model.js';

const adminRoleId = async (organizationId: string) =>
  String((await RoleModel.findOne({ organizationId, code: 'school_admin' }).lean())!._id);

async function memberToken(email: string, organizationId: string) {
  const { accessToken } = await webLogin(email);
  await request(app).post('/api/v1/me/active-organization').set(bearer(accessToken)).send({ organizationId }).expect(200);
  return accessToken;
}

describe('school user management', () => {
  it('School Admin invites a new user who sets a password and joins', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);

    const created = await request(app)
      .post('/api/v1/users')
      .set(bearer(adminToken))
      .send({ firstName: 'Ravi', lastName: 'Kumar', email: 'ravi@school.test', phone: '+91 90000 00000' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      user: { email: 'ravi@school.test', status: 'invited' },
      membership: { status: 'invited', organizationId },
      invitation: { status: 'pending' },
      existingIdentity: false,
    });

    const listed = await request(app).get('/api/v1/users?search=ravi').set(bearer(adminToken)).expect(200);
    expect(listed.body.data.total).toBe(1);
    expect(listed.body.data.items[0]).toMatchObject({ firstName: 'Ravi', membership: { status: 'invited' } });

    const pending = await request(app).get('/api/v1/invitations?status=pending').set(bearer(adminToken)).expect(200);
    expect(pending.body.data.total).toBe(1);

    const token = await deliverInvitation('ravi@school.test');
    await request(app).post('/api/v1/invitations/accept').send({ token, password: PASSWORD, firstName: 'Ravi K' }).expect(200);

    const teacher = await memberToken('ravi@school.test', organizationId);
    const me = await request(app).get('/api/v1/auth/me').set(bearer(teacher)).expect(200);
    expect(me.body.data).toMatchObject({ firstName: 'Ravi K', status: 'active', emailVerified: true });

    // Not an admin: no user management.
    await request(app).get('/api/v1/users').set(bearer(teacher)).expect(403);
    // But any member can read their organization.
    await request(app).get('/api/v1/organizations/me').set(bearer(teacher)).expect(200);
  });

  it('rejects inviting an existing member, and roles from another organization', async () => {
    const superToken = await superAdminToken();
    const a = await createActiveSchool(superToken);
    const b = await createActiveSchool(superToken);
    await addMember(a.adminToken, 't@school.test');
    await request(app).post('/api/v1/users').set(bearer(a.adminToken)).send({ firstName: 'T', lastName: 'T', email: 't@school.test' }).expect(409);

    const foreignRole = await adminRoleId(b.organizationId);
    const res = await request(app)
      .post('/api/v1/users')
      .set(bearer(a.adminToken))
      .send({ firstName: 'X', lastName: 'Y', email: 'x@school.test', roleIds: [foreignRole] });
    expect(res.status).toBe(400);
    expect(await UserModel.exists({ normalizedEmail: 'x@school.test' })).toBeNull();
  });

  it('a user can belong to several schools; removing one membership keeps the identity and the others', async () => {
    const superToken = await superAdminToken();
    const a = await createActiveSchool(superToken);
    const b = await createActiveSchool(superToken);
    const { user } = await addMember(a.adminToken, 'shared@school.test');

    // School B invites the same email: B learns nothing about the existing profile.
    const invited = await request(app)
      .post('/api/v1/users')
      .set(bearer(b.adminToken))
      .send({ firstName: 'Different', lastName: 'Name', email: 'Shared@school.test' })
      .expect(201);
    expect(invited.body.data.existingIdentity).toBe(true);
    expect(invited.body.data.user).toEqual({ id: user.id, email: 'Shared@school.test' });
    expect((await UserModel.findById(user.id).lean())!.firstName).toBe('Member');

    // Existing identity must sign in to accept.
    const token = await deliverInvitation('shared@school.test');
    const preview = await request(app).post('/api/v1/invitations/preview').send({ token }).expect(200);
    expect(preview.body.data.accountExists).toBe(true);
    const anon = await request(app).post('/api/v1/invitations/accept').send({ token });
    expect(anon.status).toBe(401);
    expect(anon.body.error.details).toEqual({ reason: 'login_required' });
    const someoneElse = await addMember(a.adminToken, 'other@school.test').then(() => webLogin('other@school.test'));
    await request(app).post('/api/v1/invitations/accept').set(bearer(someoneElse.accessToken)).send({ token }).expect(401);

    const { accessToken } = await webLogin('shared@school.test');
    const accepted = await request(app).post('/api/v1/invitations/accept').set(bearer(accessToken)).send({ token }).expect(200);
    expect(accepted.body.data).toMatchObject({ accountCreated: false, nextStep: 'select_organization' });

    const mine = await request(app).get('/api/v1/me/memberships').set(bearer(accessToken)).expect(200);
    expect(mine.body.data.map((m: { organizationId: string }) => m.organizationId).sort()).toEqual([a.organizationId, b.organizationId].sort());

    // Shared identity: neither school may edit the global profile.
    await request(app).patch(`/api/v1/users/${user.id}`).set(bearer(b.adminToken)).send({ firstName: 'Hacked' }).expect(403);

    // B removes them; A membership and the identity survive.
    await request(app).delete(`/api/v1/users/${user.id}`).set(bearer(b.adminToken)).expect(200);
    expect(await UserModel.exists({ _id: user.id })).not.toBeNull();
    const inA = await request(app).get('/api/v1/organizations/me').set(bearer(accessToken)).set('X-Organization-Id', a.organizationId);
    expect(inA.status).toBe(200);
    const inB = await request(app).get('/api/v1/organizations/me').set(bearer(accessToken)).set('X-Organization-Id', b.organizationId);
    expect(inB.body.error.code).toBe('MEMBERSHIP_INACTIVE');

    // Once only in A, A's admin may edit the profile.
    await request(app).patch(`/api/v1/users/${user.id}`).set(bearer(a.adminToken)).send({ firstName: 'Fixed' }).expect(200);
  });

  it('suspending a membership blocks that school only, and can be undone', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    const { user } = await addMember(adminToken, 't@school.test');
    const teacher = await memberToken('t@school.test', organizationId);

    await request(app).patch(`/api/v1/users/${user.id}/status`).set(bearer(adminToken)).send({ status: 'suspended' }).expect(200);
    const res = await request(app).get('/api/v1/organizations/me').set(bearer(teacher));
    expect(res.body.error.code).toBe('MEMBERSHIP_INACTIVE');
    // The global account is untouched: they can still sign in.
    await request(app).get('/api/v1/auth/me').set(bearer(teacher)).expect(200);

    await request(app).patch(`/api/v1/users/${user.id}/status`).set(bearer(adminToken)).send({ status: 'active' }).expect(200);
    await request(app).get('/api/v1/organizations/me').set(bearer(teacher)).expect(200);
  });

  it('honours membership expiry', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    const { membership } = await addMember(adminToken, 't@school.test');
    const teacher = await memberToken('t@school.test', organizationId);
    await MembershipModel.updateOne({ _id: membership.id }, { expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app).get('/api/v1/organizations/me').set(bearer(teacher));
    expect(res.body.error.code).toBe('MEMBERSHIP_INACTIVE');
  });

  it('revoking an invitation kills its link and the invited membership', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    const created = await request(app).post('/api/v1/invitations').set(bearer(adminToken)).send({ firstName: 'T', lastName: 'T', email: 't@school.test' }).expect(201);
    const token = await deliverInvitation('t@school.test');
    await request(app).delete(`/api/v1/invitations/${created.body.data.invitation.id}`).set(bearer(adminToken)).expect(200);
    await request(app).post('/api/v1/invitations/accept').send({ token, password: PASSWORD }).expect(400);
    expect((await MembershipModel.findById(created.body.data.membership.id).lean())!.status).toBe('revoked');

    // Re-inviting works.
    await request(app).post(`/api/v1/users/${created.body.data.user.id}/invite`).set(bearer(adminToken)).send({}).expect(201);
    const fresh = await deliverInvitation('t@school.test');
    await request(app).post('/api/v1/invitations/accept').send({ token: fresh, password: PASSWORD }).expect(200);
  });

  it('expired invitations cannot be accepted but can be resent', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    const created = await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ firstName: 'T', lastName: 'T', email: 't@school.test' }).expect(201);
    const token = await deliverInvitation('t@school.test');
    await InvitationModel.updateOne({ _id: created.body.data.invitation.id }, { expiresAt: new Date(Date.now() - 1000) });
    await request(app).post('/api/v1/invitations/accept').send({ token, password: PASSWORD }).expect(400);
    const expired = await request(app).get('/api/v1/invitations?status=expired').set(bearer(adminToken)).expect(200);
    expect(expired.body.data.total).toBe(1);

    await request(app).post(`/api/v1/users/${created.body.data.user.id}/resend-invitation`).set(bearer(adminToken)).expect(200);
    const fresh = await deliverInvitation('t@school.test');
    await request(app).post('/api/v1/invitations/accept').send({ token: fresh, password: PASSWORD }).expect(200);
  });

  it('School Admin can update the school profile and settings but not its identity', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    await request(app).patch(`/api/v1/organizations/${organizationId}`).set(bearer(adminToken)).send({ contact: { phone: '123' } }).expect(200);
    const org = await request(app).get(`/api/v1/organizations/${organizationId}`).set(bearer(adminToken)).expect(200);
    expect(org.body.data.contact).toMatchObject({ phone: '123', email: expect.stringContaining('@school.test') });
    await request(app).patch(`/api/v1/organizations/${organizationId}`).set(bearer(adminToken)).send({ slug: 'new-slug' }).expect(400);
    const settings = await request(app).patch(`/api/v1/organizations/${organizationId}/settings`).set(bearer(adminToken)).send({ academicYear: '2026-27' }).expect(200);
    expect(settings.body.data).toMatchObject({ academicYear: '2026-27', timezone: 'Asia/Kolkata' });
  });
});

describe('tenant isolation', () => {
  it('blocks every cross-tenant path', async () => {
    const superToken = await superAdminToken();
    const a = await createActiveSchool(superToken);
    const b = await createActiveSchool(superToken);
    const { user: bUser, membership: bMembership } = await addMember(b.adminToken, 'b-teacher@school.test');
    const bInvite = await request(app).post('/api/v1/invitations').set(bearer(b.adminToken)).send({ firstName: 'P', lastName: 'Q', email: 'pq@school.test' }).expect(201);

    // Switching context to a school you don't belong to.
    const header = await request(app).get('/api/v1/organizations/me').set(bearer(a.adminToken)).set('X-Organization-Id', b.organizationId);
    expect(header.body.error.code).toBe('TENANT_MISMATCH');
    const select = await request(app).post('/api/v1/me/active-organization').set(bearer(a.adminToken)).send({ organizationId: b.organizationId });
    expect(select.body.error.code).toBe('TENANT_MISMATCH');

    // Addressing another tenant's resources from your own context: indistinguishable from "doesn't exist".
    const orgGet = await request(app).get(`/api/v1/organizations/${b.organizationId}`).set(bearer(a.adminToken));
    expect(orgGet.body.error.code).toBe('TENANT_MISMATCH');
    await request(app).patch(`/api/v1/organizations/${b.organizationId}`).set(bearer(a.adminToken)).send({ name: 'Pwned' }).expect(403);
    await request(app).get(`/api/v1/users/${bUser.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).patch(`/api/v1/users/${bUser.id}`).set(bearer(a.adminToken)).send({ firstName: 'X' }).expect(404);
    await request(app).delete(`/api/v1/users/${bUser.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).patch(`/api/v1/users/${bUser.id}/status`).set(bearer(a.adminToken)).send({ status: 'suspended' }).expect(404);
    await request(app).get(`/api/v1/memberships/${bMembership.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).patch(`/api/v1/memberships/${bMembership.id}/status`).set(bearer(a.adminToken)).send({ status: 'suspended' }).expect(404);
    await request(app).delete(`/api/v1/memberships/${bMembership.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).delete(`/api/v1/invitations/${bInvite.body.data.invitation.id}`).set(bearer(a.adminToken)).expect(404);
    await request(app).post(`/api/v1/invitations/${bInvite.body.data.invitation.id}/resend`).set(bearer(a.adminToken)).send({}).expect(404);

    // Lists only ever show your own tenant.
    const users = await request(app).get('/api/v1/users').set(bearer(a.adminToken)).expect(200);
    expect(users.body.data.items.map((u: { email: string }) => u.email)).not.toContain('b-teacher@school.test');
    const invitations = await request(app).get('/api/v1/invitations').set(bearer(a.adminToken)).expect(200);
    expect(invitations.body.data.items.every((i: { organizationId: string }) => i.organizationId === a.organizationId)).toBe(true);

    // Nothing in B changed.
    expect((await MembershipModel.findById(bMembership.id).lean())!.status).toBe('active');
  });
});

describe('protected initial School Admin', () => {
  it('cannot be suspended, revoked or demoted by another School Admin, and admins cannot change themselves', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken, adminEmail } = await createActiveSchool(superToken);
    const roleId = await adminRoleId(organizationId);
    await addMember(adminToken, 'second-admin@school.test', { roleIds: [roleId] });
    const second = await memberToken('second-admin@school.test', organizationId);

    const primary = (await UserModel.findOne({ normalizedEmail: adminEmail }).lean())!;
    const primaryMembership = (await MembershipModel.findOne({ userId: primary._id, organizationId }).lean())!;

    for (const res of [
      await request(app).patch(`/api/v1/users/${primary._id}/status`).set(bearer(second)).send({ status: 'suspended' }),
      await request(app).delete(`/api/v1/users/${primary._id}`).set(bearer(second)),
      await request(app).patch(`/api/v1/memberships/${primaryMembership._id}`).set(bearer(second)).send({ roleIds: [] }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROLE_PROTECTED');
    }

    // Keeping the admin role while editing other fields is fine.
    await request(app).patch(`/api/v1/memberships/${primaryMembership._id}`).set(bearer(second)).send({ roleIds: [roleId] }).expect(200);

    // Self-changes are blocked (prevents locking yourself out).
    const secondUser = (await UserModel.findOne({ normalizedEmail: 'second-admin@school.test' }).lean())!;
    await request(app).patch(`/api/v1/users/${secondUser._id}/status`).set(bearer(second)).send({ status: 'inactive' }).expect(403);

    // The primary admin can demote the second admin, who then loses admin access.
    const secondMembership = (await MembershipModel.findOne({ userId: secondUser._id, organizationId }).lean())!;
    await request(app).patch(`/api/v1/memberships/${secondMembership._id}`).set(bearer(adminToken)).send({ roleIds: [] }).expect(200);
    await request(app).get('/api/v1/users').set(bearer(second)).expect(403);
  });

  it('Super Admin profile cannot be edited through school APIs', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    // The Super Admin joins a school as an ordinary member.
    await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ firstName: 'L', lastName: 'O', email: 'owner@lekho.com' }).expect(201);
    const token = await deliverInvitation('owner@lekho.com');
    await request(app).post('/api/v1/invitations/accept').set(bearer(superToken)).send({ token }).expect(200);
    const superUser = (await UserModel.findOne({ normalizedEmail: 'owner@lekho.com' }).lean())!;
    const res = await request(app).patch(`/api/v1/users/${superUser._id}`).set(bearer(adminToken)).send({ firstName: 'Nope' });
    expect(res.body.error.code).toBe('ROLE_PROTECTED');
  });
});
