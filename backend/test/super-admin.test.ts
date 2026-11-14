import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, webLogin } from './helpers.js';
import { BootstrapError, bootstrapSuperAdmin } from '../src/bootstrap/super-admin.bootstrap.js';
import { PlatformAdminModel } from '../src/modules/platform/platform-admin.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { CredentialModel } from '../src/modules/users/credential.model.js';

const input = { email: 'owner@lekho.com', firstName: 'Lekho', lastName: 'Owner', password: 'super-admin-password' };

describe('Super Admin bootstrap', () => {
  it('creates exactly one active, verified Super Admin who can sign in', async () => {
    const { userId } = await bootstrapSuperAdmin(input);
    const { accessToken } = await webLogin(input.email, input.password);
    const me = await request(app).get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
    expect(me.body.data).toMatchObject({ id: userId, isSuperAdmin: true, status: 'active', emailVerified: true });
  });

  it('refuses a second bootstrap', async () => {
    await bootstrapSuperAdmin(input);
    await expect(bootstrapSuperAdmin({ ...input, email: 'second@lekho.com' })).rejects.toBeInstanceOf(BootstrapError);
    expect(await PlatformAdminModel.countDocuments()).toBe(1);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('creates only one Super Admin when two bootstraps race', async () => {
    const results = await Promise.allSettled([
      bootstrapSuperAdmin(input),
      bootstrapSuperAdmin({ ...input, email: 'racer@lekho.com' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await PlatformAdminModel.countDocuments()).toBe(1);
    // The loser's transaction rolled back: no orphan user or credential.
    expect(await UserModel.countDocuments()).toBe(1);
    expect(await CredentialModel.countDocuments()).toBe(1);
  });

  it('rejects a weak password', async () => {
    await expect(bootstrapSuperAdmin({ ...input, password: 'short' })).rejects.toThrow();
    expect(await PlatformAdminModel.countDocuments()).toBe(0);
  });

  it('cannot reuse an existing user’s email', async () => {
    await UserModel.create({ firstName: 'A', lastName: 'B', email: input.email, normalizedEmail: input.email, status: 'active' });
    await expect(bootstrapSuperAdmin(input)).rejects.toBeInstanceOf(BootstrapError);
    expect(await PlatformAdminModel.countDocuments()).toBe(0);
  });

  it('rejects a second singleton record at the database level', async () => {
    await bootstrapSuperAdmin(input);
    await expect(
      PlatformAdminModel.create({ _id: 'platform_admin', superAdminUserId: new UserModel()._id, initialized: true, initializedAt: new Date() }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      PlatformAdminModel.create({ _id: 'another', superAdminUserId: new UserModel()._id, initialized: true, initializedAt: new Date() }),
    ).rejects.toThrow(/validation/i);
  });
});
