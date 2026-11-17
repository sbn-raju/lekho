import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, mobileLogin, PASSWORD, tokenFromEmail, webLogin } from './helpers.js';
import { SessionModel } from '../src/modules/sessions/session.model.js';
import { CredentialModel } from '../src/modules/users/credential.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { testOutbox } from '../src/modules/notifications/mailer.js';

const api = '/api/v1/auth';

describe('login', () => {
  it('signs in a web client: access token in body, refresh token only in an HttpOnly cookie', async () => {
    const user = await createUser({ email: 'Raju@Example.com' });
    const { res, accessToken } = await webLogin('  raju@example.COM ');

    expect(accessToken).toMatch(/^ey/);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user).toMatchObject({ id: String(user._id), email: 'Raju@Example.com' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const rt = cookies.find((c) => c.startsWith('lekho_rt='))!;
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('lekho_csrf='))).not.toMatch(/HttpOnly/i);

    const header = JSON.parse(Buffer.from(accessToken.split('.')[0]!, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(header.kid).toBeTruthy();
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString());
    expect(payload).toMatchObject({ sub: String(user._id), iss: 'https://auth.lekho.com', aud: 'lekho-api', token_version: 1 });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'token_version']);
  });

  it('returns the same generic error for an unknown email and a wrong password', async () => {
    await createUser({ email: 'a@example.com' });
    const unknown = await request(app).post(`${api}/login`).send({ email: 'nobody@example.com', password: PASSWORD });
    const wrong = await request(app).post(`${api}/login`).send({ email: 'a@example.com', password: 'nope-nope-nope' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', details: {} },
    });
  });

  it('locks the credential after repeated failures, even for the right password', async () => {
    await createUser({ email: 'b@example.com' });
    for (let i = 0; i < 5; i++) {
      await request(app).post(`${api}/login`).send({ email: 'b@example.com', password: 'wrong-password-x' }).expect(401);
    }
    const res = await request(app).post(`${api}/login`).send({ email: 'b@example.com', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rejects unverified and suspended accounts after a correct password', async () => {
    await createUser({ email: 'pending@example.com', status: 'pending_verification', emailVerified: false });
    await createUser({ email: 'susp@example.com', status: 'suspended' });
    const pending = await request(app).post(`${api}/login`).send({ email: 'pending@example.com', password: PASSWORD });
    expect(pending.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const susp = await request(app).post(`${api}/login`).send({ email: 'susp@example.com', password: PASSWORD });
    expect(susp.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('validates input with the standard error envelope', async () => {
    const res = await request(app).post(`${api}/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('authenticated requests', () => {
  it('requires a valid bearer token', async () => {
    await request(app).get(`${api}/me`).expect(401);
    const res = await request(app).get(`${api}/me`).set(bearer('garbage'));
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user', async () => {
    const user = await createUser();
    const { accessToken } = await webLogin(user.email);
    const res = await request(app).get(`${api}/me`).set(bearer(accessToken)).expect(200);
    expect(res.body.data).toMatchObject({ id: String(user._id), isSuperAdmin: false });
  });

  it('stops working immediately when the user is suspended', async () => {
    const user = await createUser();
    const { accessToken } = await webLogin(user.email);
    await UserModel.updateOne({ _id: user._id }, { status: 'suspended' });
    const res = await request(app).get(`${api}/me`).set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('refresh token rotation', () => {
  it('rotates the cookie and requires the CSRF header', async () => {
    const user = await createUser();
    const { agent, csrfToken, res: loginRes } = await webLogin(user.email);
    const firstCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lekho_rt='));

    const noCsrf = await agent.post(`${api}/refresh`);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');
    const badCsrf = await agent.post(`${api}/refresh`).set('X-CSRF-Token', 'x'.repeat(43));
    expect(badCsrf.body.error.code).toBe('CSRF_INVALID');

    const ok = await agent.post(`${api}/refresh`).set('X-CSRF-Token', csrfToken).expect(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.body.data.refreshToken).toBeUndefined();
    const newCookie = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lekho_rt='));
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toEqual(firstCookie);
  });

  it('detects reuse of a rotated token and revokes the session', async () => {
    const user = await createUser();
    const { refreshToken: original, accessToken } = await mobileLogin(user.email);

    const r1 = await request(app).post(`${api}/refresh`).send({ refreshToken: original }).expect(200);
    const rotated = r1.body.data.refreshToken as string;
    expect(rotated).not.toEqual(original);

    // Move past the concurrency grace window, then replay the original (stolen) token.
    await SessionModel.updateOne({}, { rotatedAt: new Date(Date.now() - 60_000) });
    const replay = await request(app).post(`${api}/refresh`).send({ refreshToken: original });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');

    // The whole family is dead: the legitimate holder's newer token and the access token stop working.
    await request(app).post(`${api}/refresh`).send({ refreshToken: rotated }).expect(401);
    await request(app).get(`${api}/me`).set(bearer(accessToken)).expect(401);
    expect(await AuditLogModel.countDocuments({ action: 'auth.refresh_token.reuse_detected' })).toBe(1);
  });

  it('tolerates a concurrent refresh with the just-rotated token inside the grace window', async () => {
    const user = await createUser();
    const { refreshToken: original } = await mobileLogin(user.email);
    await request(app).post(`${api}/refresh`).send({ refreshToken: original }).expect(200);
    const again = await request(app).post(`${api}/refresh`).send({ refreshToken: original }).expect(200);
    expect(again.body.data.accessToken).toBeTruthy();
    expect(again.body.data.refreshToken).toBeUndefined();
    expect((await SessionModel.findOne())!.status).toBe('active');
  });

  it('rejects malformed and unknown refresh tokens', async () => {
    await request(app).post(`${api}/refresh`).send({ refreshToken: 'no-dot-in-this-token-at-all' }).expect(401);
    await request(app).post(`${api}/refresh`).send({ refreshToken: 'unknownfamily.unknownsecretvalue' }).expect(401);
    await request(app).post(`${api}/refresh`).expect(401);
  });

  it('stores only hashes of refresh tokens', async () => {
    const user = await createUser();
    const { refreshToken } = await mobileLogin(user.email);
    const raw = JSON.stringify(await SessionModel.find().lean());
    expect(raw).not.toContain(refreshToken);
    expect(raw).not.toContain(refreshToken.split('.')[1]);
  });
});

describe('logout and sessions', () => {
  it('logout revokes the current session only', async () => {
    const user = await createUser();
    const a = await webLogin(user.email);
    const b = await mobileLogin(user.email);
    await a.agent.post(`${api}/logout`).set(bearer(a.accessToken)).expect(200);
    await request(app).get(`${api}/me`).set(bearer(a.accessToken)).expect(401);
    await a.agent.post(`${api}/refresh`).set('X-CSRF-Token', a.csrfToken).expect(401);
    await request(app).get(`${api}/me`).set(bearer(b.accessToken)).expect(200);
  });

  it('logout-all revokes every session', async () => {
    const user = await createUser();
    const a = await webLogin(user.email);
    const b = await mobileLogin(user.email);
    await request(app).post(`${api}/logout-all`).set(bearer(a.accessToken)).expect(200);
    await request(app).get(`${api}/me`).set(bearer(b.accessToken)).expect(401);
    await request(app).post(`${api}/refresh`).send({ refreshToken: b.refreshToken }).expect(401);
  });

  it('lists sessions and revokes one by id, but not another user’s', async () => {
    const user = await createUser();
    const other = await createUser();
    const a = await webLogin(user.email);
    const b = await mobileLogin(user.email);
    const o = await mobileLogin(other.email);

    const list = await request(app).get(`${api}/sessions`).set(bearer(a.accessToken)).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const mobile = list.body.data.find((s: { clientType: string }) => s.clientType === 'mobile');

    const otherList = await request(app).get(`${api}/sessions`).set(bearer(o.accessToken)).expect(200);
    await request(app).delete(`${api}/sessions/${otherList.body.data[0].id}`).set(bearer(a.accessToken)).expect(404);

    await request(app).delete(`${api}/sessions/${mobile.id}`).set(bearer(a.accessToken)).expect(200);
    await request(app).get(`${api}/me`).set(bearer(b.accessToken)).expect(401);
    await request(app).get(`${api}/me`).set(bearer(o.accessToken)).expect(200);
  });
});

describe('password reset', () => {
  it('gives the same response whether or not the email exists', async () => {
    await createUser({ email: 'known@example.com' });
    const known = await request(app).post(`${api}/forgot-password`).send({ email: 'known@example.com' });
    const unknown = await request(app).post(`${api}/forgot-password`).send({ email: 'unknown@example.com' });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
  });

  it('resets with a single-use token, signs out everywhere, and unlocks the account', async () => {
    const user = await createUser({ email: 'reset@example.com' });
    const session = await mobileLogin(user.email);
    await CredentialModel.updateOne({ userId: user._id }, { lockedUntil: new Date(Date.now() + 60_000) });

    await request(app).post(`${api}/forgot-password`).send({ email: 'reset@example.com' }).expect(202);
    const token = await tokenFromEmail('reset@example.com', '/reset-password');

    await request(app).post(`${api}/reset-password`).send({ token, password: 'short' }).expect(400);
    await request(app).post(`${api}/reset-password`).send({ token, password: 'a-brand-new-password' }).expect(200);
    await request(app).post(`${api}/reset-password`).send({ token, password: 'another-new-password' }).expect(400);

    await request(app).get(`${api}/me`).set(bearer(session.accessToken)).expect(401);
    await request(app).post(`${api}/login`).send({ email: user.email, password: PASSWORD }).expect(401);
    await webLogin(user.email, 'a-brand-new-password');
  });

  it('only the newest reset link works', async () => {
    await createUser({ email: 'twice@example.com' });
    await request(app).post(`${api}/forgot-password`).send({ email: 'twice@example.com' });
    const first = await tokenFromEmail('twice@example.com', '/reset-password');
    testOutbox.length = 0;
    await request(app).post(`${api}/forgot-password`).send({ email: 'twice@example.com' });
    const second = await tokenFromEmail('twice@example.com', '/reset-password');
    await request(app).post(`${api}/reset-password`).send({ token: first, password: 'a-brand-new-password' }).expect(400);
    await request(app).post(`${api}/reset-password`).send({ token: second, password: 'a-brand-new-password' }).expect(200);
  });
});

describe('email verification', () => {
  it('verifies via the emailed link and activates the account', async () => {
    const user = await createUser({ email: 'verify@example.com', status: 'pending_verification', emailVerified: false });
    await request(app).post(`${api}/resend-verification`).send({ email: 'verify@example.com' }).expect(202);
    const token = await tokenFromEmail('verify@example.com', '/verify-email');

    await request(app).post(`${api}/verify-email`).send({ token }).expect(200);
    await request(app).post(`${api}/verify-email`).send({ token }).expect(400);
    const updated = await UserModel.findById(user._id).lean();
    expect(updated).toMatchObject({ status: 'active', emailVerified: true });
    await webLogin(user.email);
  });

  it('does not send verification email to already-verified users', async () => {
    await createUser({ email: 'done@example.com' });
    await request(app).post(`${api}/resend-verification`).send({ email: 'done@example.com' }).expect(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(testOutbox).toHaveLength(0);
  });
});

describe('change password', () => {
  it('requires the current password and signs out other devices only', async () => {
    const user = await createUser();
    const current = await webLogin(user.email);
    const other = await mobileLogin(user.email);

    const wrong = await request(app)
      .post(`${api}/change-password`)
      .set(bearer(current.accessToken))
      .send({ currentPassword: 'not-my-password', newPassword: 'a-brand-new-password' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    await request(app)
      .post(`${api}/change-password`)
      .set(bearer(current.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' })
      .expect(200);

    await request(app).get(`${api}/me`).set(bearer(current.accessToken)).expect(200);
    await request(app).get(`${api}/me`).set(bearer(other.accessToken)).expect(401);
    await webLogin(user.email, 'a-brand-new-password');
  });
});

describe('audit', () => {
  it('records auth events without passwords or tokens', async () => {
    const user = await createUser();
    await request(app).post(`${api}/login`).send({ email: user.email, password: 'wrong-password-x' });
    const { refreshToken, accessToken } = await mobileLogin(user.email);
    await request(app).post(`${api}/refresh`).send({ refreshToken });

    const logs = await AuditLogModel.find().lean();
    expect(logs.map((l) => `${l.action}:${l.result}`)).toEqual(
      expect.arrayContaining(['auth.login:failure', 'auth.login:success']),
    );
    const raw = JSON.stringify(logs);
    for (const secret of [PASSWORD, 'wrong-password-x', refreshToken, accessToken, '$argon2']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('is immutable through the model', async () => {
    await createUser().then((u) => request(app).post(`${api}/login`).send({ email: u.email, password: PASSWORD }));
    await expect(AuditLogModel.deleteMany({})).rejects.toThrow(/immutable/);
    await expect(AuditLogModel.updateOne({}, { result: 'failure' })).rejects.toThrow(/immutable/);
  });
});

describe('JWKS', () => {
  it('publishes the verification key', async () => {
    const res = await request(app).get('/.well-known/jwks.json').expect(200);
    expect(res.body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(res.body.keys[0].d).toBeUndefined();
  });
});
