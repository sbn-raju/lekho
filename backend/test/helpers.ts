import { bootstrapSuperAdmin } from '../src/bootstrap/super-admin.bootstrap.js';
import { invitationDelivery } from '../src/modules/invitations/invitation.delivery.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { UserModel, type UserStatus } from '../src/modules/users/user.model.js';
import { CredentialModel } from '../src/modules/users/credential.model.js';
import { passwordService } from '../src/modules/auth/password.service.js';
import { normalizeEmail } from '../src/common/utils/crypto.js';
import { testOutbox } from '../src/modules/notifications/mailer.js';

export const app = createApp();
export const PASSWORD = 'correct-horse-battery';

export async function createUser(
  overrides: { email?: string; status?: UserStatus; emailVerified?: boolean; password?: string | null } = {},
) {
  const email = overrides.email ?? `user${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await UserModel.create({
    firstName: 'Test',
    lastName: 'User',
    email,
    normalizedEmail: normalizeEmail(email),
    status: overrides.status ?? 'active',
    emailVerified: overrides.emailVerified ?? true,
  });
  if (overrides.password !== null) {
    await CredentialModel.create({
      userId: user._id,
      passwordHash: await passwordService.hash(overrides.password ?? PASSWORD),
      passwordChangedAt: new Date(),
    });
  }
  return user;
}

/** Web login via an agent, which keeps the HttpOnly cookies like a browser would. */
export async function webLogin(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { agent, res, accessToken: res.body.data.accessToken as string, csrfToken: res.body.data.csrfToken as string };
}

export async function mobileLogin(email: string, password = PASSWORD) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Client-Type', 'mobile')
    .send({ email, password })
    .expect(200);
  return { accessToken: res.body.data.accessToken as string, refreshToken: res.body.data.refreshToken as string };
}

/** Polls the in-memory outbox (emails are sent in the background) and extracts the token from the link. */
export async function tokenFromEmail(to: string, path: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const msg = [...testOutbox].reverse().find((m) => m.to === to && m.text.includes(path));
    const match = msg?.text.match(/token=([A-Za-z0-9_\-%]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No email to ${to} containing ${path}`);
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// ---------- Phase 2 helpers ----------

export const SUPER = { email: 'owner@lekho.com', firstName: 'Lekho', lastName: 'Owner', password: 'super-admin-password' };

export async function superAdminToken() {
  await bootstrapSuperAdmin(SUPER);
  return (await webLogin(SUPER.email, SUPER.password)).accessToken;
}

/** Runs the delivery worker and returns the token from the newest invitation email to `to`. */
export async function deliverInvitation(to: string) {
  await invitationDelivery.runOnce();
  return tokenFromEmail(to, '/invitations/accept');
}

let schoolSeq = 0;

/**
 * Drives the real onboarding flow: create org → provision admin → deliver → accept → sign in →
 * select org. Returns the admin's token (with the school selected) and IDs.
 */
export async function createActiveSchool(superToken: string, opts: { adminEmail?: string } = {}) {
  const n = ++schoolSeq;
  const org = await request(app)
    .post('/api/v1/platform/organizations')
    .set(bearer(superToken))
    .send({ name: `School ${n}`, slug: `school-${n}`, code: `SCH${n}`, contact: { email: `office${n}@school.test` } })
    .expect(201);
  const organizationId = org.body.data.id as string;
  const adminEmail = opts.adminEmail ?? `admin${n}@school.test`;
  await request(app)
    .post(`/api/v1/platform/organizations/${organizationId}/admin`)
    .set(bearer(superToken))
    .send({ firstName: 'Admin', lastName: `Number${n}`, email: adminEmail })
    .expect(201);
  const token = await deliverInvitation(adminEmail);
  await request(app).post('/api/v1/invitations/accept').send({ token, password: PASSWORD }).expect(200);
  const { accessToken } = await webLogin(adminEmail);
  await request(app).post('/api/v1/me/active-organization').set(bearer(accessToken)).send({ organizationId }).expect(200);
  return { organizationId, adminEmail, adminToken: accessToken };
}

/** Invites `email` into the admin's school and accepts as a brand-new identity. */
export async function addMember(adminToken: string, email: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/users')
    .set(bearer(adminToken))
    .send({ firstName: 'Member', lastName: 'Person', email, ...extra })
    .expect(201);
  const token = await deliverInvitation(email);
  await request(app).post('/api/v1/invitations/accept').send({ token, password: PASSWORD }).expect(200);
  return res.body.data as { user: { id: string }; membership: { id: string } };
}
