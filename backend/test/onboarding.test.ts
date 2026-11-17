import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, bearer, createActiveSchool, createUser, deliverInvitation, PASSWORD, superAdminToken, webLogin } from './helpers.js';
import { mailer, testOutbox } from '../src/modules/notifications/mailer.js';
import { invitationDelivery } from '../src/modules/invitations/invitation.delivery.js';
import { InvitationModel } from '../src/modules/invitations/invitation.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { RoleModel } from '../src/modules/roles/role.model.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';

const orgBody = { name: 'ABC International School', slug: 'abc-international', code: 'abc01', contact: { email: 'office@abc.test' } };

function createOrg(token: string, body: Record<string, unknown> = orgBody) {
  return request(app).post('/api/v1/platform/organizations').set(bearer(token)).send(body);
}

describe('platform access', () => {
  it('is Super Admin only', async () => {
    await superAdminToken();
    const user = await createUser();
    const { accessToken } = await webLogin(user.email);
    const res = await request(app).get('/api/v1/platform/organizations').set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await request(app).get('/api/v1/platform/organizations').expect(401);
  });

  it('is denied to School Admins', async () => {
    const superToken = await superAdminToken();
    const { adminToken } = await createActiveSchool(superToken);
    await request(app).get('/api/v1/platform/organizations').set(bearer(adminToken)).expect(403);
    await createOrg(adminToken).expect(403);
  });
});

describe('organization creation', () => {
  it('creates a draft organization with its protected School Admin role', async () => {
    const token = await superAdminToken();
    const res = await createOrg(token).expect(201);
    expect(res.body.data).toMatchObject({
      name: 'ABC International School',
      slug: 'abc-international',
      code: 'ABC01',
      status: 'draft',
      onboarding: { state: 'organization_created' },
    });
    const role = await RoleModel.findOne({ organizationId: res.body.data.id }).lean();
    expect(role).toMatchObject({ code: 'school_admin', isProtected: true, isSystem: true, type: 'organization' });
  });

  it('rejects duplicate slugs and codes, and bad input', async () => {
    const token = await superAdminToken();
    await createOrg(token).expect(201);
    const dupSlug = await createOrg(token, { ...orgBody, code: 'OTHER' });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.error.details).toEqual({ fields: ['slug'] });
    await createOrg(token, { ...orgBody, slug: 'other-slug' }).expect(409);
    await createOrg(token, { ...orgBody, slug: 'Bad Slug!' }).expect(400);
    await createOrg(token, { ...orgBody, slug: 'tz-check', code: 'TZ', settings: { timezone: 'Mars/Olympus' } }).expect(400);
  });

  it('lists and searches organizations', async () => {
    const token = await superAdminToken();
    await createOrg(token).expect(201);
    await createOrg(token, { ...orgBody, name: 'XYZ Public School', slug: 'xyz', code: 'XYZ' }).expect(201);
    const all = await request(app).get('/api/v1/platform/organizations').set(bearer(token)).expect(200);
    expect(all.body.data).toMatchObject({ total: 2, page: 1 });
    const search = await request(app).get('/api/v1/platform/organizations?search=xyz').set(bearer(token)).expect(200);
    expect(search.body.data.items.map((o: { slug: string }) => o.slug)).toEqual(['xyz']);
  });
});

describe('onboarding the initial School Admin', () => {
  it('runs end to end: provision → email → accept → organization active → admin signs in', async () => {
    const token = await superAdminToken();
    const orgId = (await createOrg(token)).body.data.id;

    const prov = await request(app)
      .post(`/api/v1/platform/organizations/${orgId}/admin`)
      .set(bearer(token))
      .send({ firstName: 'Priya', lastName: 'Sharma', email: 'priya@abc.test' })
      .expect(201);
    expect(prov.body.data.organization).toMatchObject({ status: 'onboarding', onboarding: { state: 'invitation_pending' } });
    expect(prov.body.data.invitation).toMatchObject({ purpose: 'initial_admin', status: 'pending', delivery: { status: 'queued' } });

    // Cannot activate before the admin accepts.
    await request(app).patch(`/api/v1/platform/organizations/${orgId}/status`).set(bearer(token)).send({ status: 'active' }).expect(409);

    const inviteToken = await deliverInvitation('priya@abc.test');
    expect((await InvitationModel.findOne().lean())!.delivery.status).toBe('sent');

    const preview = await request(app).post('/api/v1/invitations/preview').send({ token: inviteToken }).expect(200);
    expect(preview.body.data).toMatchObject({ email: 'priya@abc.test', organization: { name: 'ABC International School' }, accountExists: false });

    // New identity must choose a password.
    await request(app).post('/api/v1/invitations/accept').send({ token: inviteToken }).expect(400);
    const accept = await request(app).post('/api/v1/invitations/accept').send({ token: inviteToken, password: PASSWORD }).expect(200);
    expect(accept.body.data).toMatchObject({ organizationId: orgId, accountCreated: true, nextStep: 'sign_in' });
    // Single use.
    await request(app).post('/api/v1/invitations/accept').send({ token: inviteToken, password: PASSWORD }).expect(400);

    const org = await request(app).get(`/api/v1/platform/organizations/${orgId}`).set(bearer(token)).expect(200);
    expect(org.body.data).toMatchObject({ status: 'active', onboarding: { state: 'active' } });
    expect(org.body.data.primaryAdminUserId).toBeTruthy();

    const { accessToken } = await webLogin('priya@abc.test');
    const mine = await request(app).get('/api/v1/me/memberships').set(bearer(accessToken)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ status: 'active', usable: true, roles: [{ code: 'school_admin' }] });

    // Org APIs need a selected organization.
    const noCtx = await request(app).get('/api/v1/organizations/me').set(bearer(accessToken));
    expect(noCtx.body.error.code).toBe('ORGANIZATION_CONTEXT_REQUIRED');
    await request(app).post('/api/v1/me/active-organization').set(bearer(accessToken)).send({ organizationId: orgId }).expect(200);
    const me = await request(app).get('/api/v1/organizations/me').set(bearer(accessToken)).expect(200);
    expect(me.body.data).toMatchObject({ id: orgId, name: 'ABC International School' });
    expect(me.body.data.onboarding).toBeUndefined();

    const actions = (await AuditLogModel.find({ organizationId: orgId }).lean()).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['organization.created', 'organization.admin_provisioned', 'invitation.accepted', 'organization.activated']));
  });

  it('is idempotent for the same email and replaces a not-yet-accepted admin', async () => {
    const token = await superAdminToken();
    const orgId = (await createOrg(token)).body.data.id;
    const send = (email: string) =>
      request(app).post(`/api/v1/platform/organizations/${orgId}/admin`).set(bearer(token)).send({ firstName: 'A', lastName: 'B', email });

    const first = await send('one@abc.test').expect(201);
    const again = await send('ONE@abc.test').expect(200);
    expect(again.body.data.idempotent).toBe(true);
    expect(again.body.data.invitation.id).toBe(first.body.data.invitation.id);
    expect(await InvitationModel.countDocuments()).toBe(1);

    await send('two@abc.test').expect(201);
    const statuses = (await InvitationModel.find().sort({ createdAt: 1 }).lean()).map((i) => `${i.email}:${i.status}`);
    expect(statuses).toEqual(['one@abc.test:revoked', 'two@abc.test:pending']);
    const oldMembership = await MembershipModel.findOne({ _id: first.body.data.invitation.membershipId }).lean();
    expect(oldMembership!.status).toBe('revoked');

    // After activation, provisioning is closed.
    const t = await deliverInvitation('two@abc.test');
    await request(app).post('/api/v1/invitations/accept').send({ token: t, password: PASSWORD }).expect(200);
    await send('three@abc.test').expect(409);
  });

  it('only the newest invitation email works after a resend', async () => {
    const token = await superAdminToken();
    const orgId = (await createOrg(token)).body.data.id;
    await request(app).post(`/api/v1/platform/organizations/${orgId}/admin`).set(bearer(token)).send({ firstName: 'A', lastName: 'B', email: 'a@abc.test' });
    const first = await deliverInvitation('a@abc.test');
    testOutbox.length = 0;
    await request(app).post(`/api/v1/platform/organizations/${orgId}/admin/resend-invitation`).set(bearer(token)).expect(200);
    const second = await deliverInvitation('a@abc.test');
    expect(second).not.toBe(first);
    await request(app).post('/api/v1/invitations/preview').send({ token: first }).expect(400);
    await request(app).post('/api/v1/invitations/preview').send({ token: second }).expect(200);
    // Only a hash is stored.
    expect(JSON.stringify(await InvitationModel.find().lean())).not.toContain(second);
  });
});

describe('invitation delivery worker', () => {
  it('retries failed sends with backoff and eventually gives up', async () => {
    const token = await superAdminToken();
    const orgId = (await createOrg(token)).body.data.id;
    await request(app).post(`/api/v1/platform/organizations/${orgId}/admin`).set(bearer(token)).send({ firstName: 'A', lastName: 'B', email: 'a@abc.test' });

    const spy = vi.spyOn(mailer, 'send').mockRejectedValue(new Error('SMTP down'));
    try {
      await invitationDelivery.runOnce();
      let inv = (await InvitationModel.findOne().lean())!;
      expect(inv.delivery).toMatchObject({ status: 'retrying', attempts: 1, lastError: 'SMTP down' });
      expect(inv.delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      // Not due yet: nothing happens.
      expect(await invitationDelivery.runOnce()).toBe(0);

      for (let i = 0; i < 4; i++) {
        await InvitationModel.updateOne({}, { 'delivery.nextAttemptAt': new Date(0) });
        await invitationDelivery.runOnce();
      }
      inv = (await InvitationModel.findOne().lean())!;
      expect(inv.delivery).toMatchObject({ status: 'failed', attempts: 5 });
    } finally {
      spy.mockRestore();
    }

    // Re-provisioning the same admin re-queues a failed delivery.
    await request(app).post(`/api/v1/platform/organizations/${orgId}/admin`).set(bearer(token)).send({ firstName: 'A', lastName: 'B', email: 'a@abc.test' }).expect(200);
    await deliverInvitation('a@abc.test');
    expect((await InvitationModel.findOne().lean())!.delivery.status).toBe('sent');
  });

  it('reclaims a delivery whose worker crashed mid-send', async () => {
    const token = await superAdminToken();
    const orgId = (await createOrg(token)).body.data.id;
    await request(app).post(`/api/v1/platform/organizations/${orgId}/admin`).set(bearer(token)).send({ firstName: 'A', lastName: 'B', email: 'a@abc.test' });
    await InvitationModel.updateOne({}, { 'delivery.status': 'sending', 'delivery.lockedUntil': new Date(Date.now() - 1000) });
    await deliverInvitation('a@abc.test');
  });
});

describe('organization status', () => {
  it('suspending a school blocks its members; reactivating restores access', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    await request(app).get('/api/v1/organizations/me').set(bearer(adminToken)).expect(200);

    await request(app).patch(`/api/v1/platform/organizations/${organizationId}/status`).set(bearer(superToken)).send({ status: 'suspended', reason: 'Billing' }).expect(200);
    const blocked = await request(app).get('/api/v1/organizations/me').set(bearer(adminToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_INACTIVE');

    await request(app).patch(`/api/v1/platform/organizations/${organizationId}/status`).set(bearer(superToken)).send({ status: 'active' }).expect(200);
    await request(app).get('/api/v1/organizations/me').set(bearer(adminToken)).expect(200);

    await request(app).patch(`/api/v1/platform/organizations/${organizationId}/status`).set(bearer(superToken)).send({ status: 'archived' }).expect(200);
    await request(app).patch(`/api/v1/platform/organizations/${organizationId}/status`).set(bearer(superToken)).send({ status: 'active' }).expect(409);
    expect((await OrganizationModel.findById(organizationId).lean())!.status).toBe('archived');
  });

  it('invitations cannot be accepted for a suspended school', async () => {
    const superToken = await superAdminToken();
    const { organizationId, adminToken } = await createActiveSchool(superToken);
    await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ firstName: 'T', lastName: 'One', email: 't@school.test' }).expect(201);
    const t = await deliverInvitation('t@school.test');
    await request(app).patch(`/api/v1/platform/organizations/${organizationId}/status`).set(bearer(superToken)).send({ status: 'suspended' }).expect(200);
    await request(app).post('/api/v1/invitations/accept').send({ token: t, password: PASSWORD }).expect(400);
  });
});
