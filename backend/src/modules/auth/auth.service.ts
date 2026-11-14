import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { normalizeEmail, randomToken, sha256 } from '../../common/utils/crypto.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { UserModel, toPublicUser, type UserDocument } from '../users/user.model.js';
import { CredentialModel } from '../users/credential.model.js';
import { SessionModel, type ClientType } from '../sessions/session.model.js';
import { sessionService } from '../sessions/session.service.js';
import { platformAdminService } from '../platform/platform-admin.model.js';
import { auditService } from '../audit/audit.service.js';
import { mailer } from '../notifications/mailer.js';
import { passwordService } from './password.service.js';
import { tokenService } from './token.service.js';
import { EmailVerificationTokenModel, PasswordResetTokenModel } from './one-time-token.models.js';
import type {
  ChangePasswordInput,
  EmailOnlyInput,
  LoginInput,
  ResetPasswordInput,
  TokenOnlyInput,
} from './auth.validators.js';

const INVALID_CREDENTIALS = () => new ApiError('INVALID_CREDENTIALS', 'Invalid email or password.');

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  /** Only set when a new refresh token was minted (login, or a non-grace refresh). */
  refreshToken?: string;
  /** Web sessions only: double-submit token the browser must echo in X-CSRF-Token when refreshing. */
  csrfToken?: string;
  clientType: ClientType;
  user?: ReturnType<typeof toPublicUser>;
}

/** Statuses that may hold a session. Everything else is rejected at login and on every request. */
export function assertUserCanAuthenticate(user: Pick<UserDocument, 'status' | 'emailVerified'>): void {
  switch (user.status) {
    case 'active':
      if (!user.emailVerified) throw new ApiError('EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in.');
      return;
    case 'pending_verification':
    case 'invited':
      throw new ApiError('EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in.');
    case 'locked':
      throw new ApiError('ACCOUNT_LOCKED', 'This account is locked. Contact your administrator.');
    default:
      throw new ApiError('ACCOUNT_DISABLED', 'This account is not active. Contact your administrator.');
  }
}

async function createOneTimeToken(
  model: typeof EmailVerificationTokenModel | typeof PasswordResetTokenModel,
  userId: Types.ObjectId | string,
  ttlMs: number,
): Promise<string> {
  const now = new Date();
  // Only the newest link works: retire any outstanding ones.
  await model.updateMany({ userId, consumedAt: null }, { $set: { consumedAt: now } });
  const token = randomToken();
  await model.create({ userId, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + ttlMs) });
  return token;
}

/** Atomically marks a one-time token consumed and returns its user ID, or throws if unusable. */
async function consumeOneTimeToken(
  model: typeof EmailVerificationTokenModel | typeof PasswordResetTokenModel,
  token: string,
): Promise<Types.ObjectId> {
  const now = new Date();
  const record = await model.findOneAndUpdate(
    { tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
  );
  if (!record) throw ApiError.badRequest('This link is invalid or has expired.');
  return record.userId;
}

const link = (path: string, token: string) => `${env.APP_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;

export const authService = {
  async login(input: LoginInput, clientType: ClientType, meta: RequestMeta): Promise<AuthResult> {
    const normalizedEmail = normalizeEmail(input.email);
    const user = await UserModel.findOne({ normalizedEmail });
    const credential = user ? await CredentialModel.findOne({ userId: user._id }) : null;

    if (!user || !credential || user.status === 'deleted') {
      await passwordService.verifyDummy(input.password);
      await auditService.record({ action: 'auth.login', resource: 'user', result: 'failure', metadata: { reason: 'unknown_account' }, meta });
      throw INVALID_CREDENTIALS();
    }

    const audit = (result: 'success' | 'failure', reason?: string) =>
      auditService.record({
        actorId: String(user._id),
        action: 'auth.login',
        resource: 'user',
        resourceId: String(user._id),
        result,
        ...(reason && { metadata: { reason } }),
        meta,
      });

    if (credential.lockedUntil && credential.lockedUntil > new Date()) {
      await audit('failure', 'locked_out');
      throw new ApiError('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again later or reset your password.');
    }

    if (!(await passwordService.verify(credential.passwordHash, input.password))) {
      // Atomic increment so parallel guesses can't slip past the limit.
      const updated = await CredentialModel.findOneAndUpdate(
        { _id: credential._id },
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after' },
      );
      if (updated && updated.failedLoginAttempts >= env.MAX_FAILED_LOGIN_ATTEMPTS) {
        await CredentialModel.updateOne(
          { _id: credential._id },
          { $set: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60_000) } },
        );
        await audit('failure', 'locked_out_now');
      } else {
        await audit('failure', 'bad_password');
      }
      throw INVALID_CREDENTIALS();
    }

    try {
      assertUserCanAuthenticate(user);
    } catch (err) {
      await audit('failure', `status_${user.status}`);
      throw err;
    }

    const credentialUpdate: Record<string, unknown> = { failedLoginAttempts: 0 };
    if (passwordService.needsRehash(credential.passwordHash)) {
      credentialUpdate.passwordHash = await passwordService.hash(input.password);
    }
    await CredentialModel.updateOne({ _id: credential._id }, { $set: credentialUpdate, $unset: { lockedUntil: 1 } });

    const { sessionId, refreshToken, csrfToken } = await sessionService.create({
      userId: String(user._id),
      clientType,
      deviceName: input.deviceName,
      meta,
    });
    user.lastLoginAt = new Date();
    await user.save();
    await audit('success');

    const access = await tokenService.signAccessToken({ userId: String(user._id), sessionId, tokenVersion: user.tokenVersion });
    return { ...access, refreshToken, csrfToken, clientType, user: toPublicUser(user) };
  },

  async refresh(presentedToken: string, csrfToken: string | null | undefined, meta: RequestMeta): Promise<AuthResult> {
    const result = await sessionService.rotate(presentedToken, csrfToken, meta);
    const user = await UserModel.findById(result.userId);
    try {
      if (!user) throw ApiError.unauthenticated();
      assertUserCanAuthenticate(user);
    } catch (err) {
      await sessionService.revokeSession(result.sessionId, 'user_revoked');
      throw err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED' ? ApiError.unauthenticated() : err;
    }
    const access = await tokenService.signAccessToken({
      userId: result.userId,
      sessionId: result.sessionId,
      tokenVersion: user.tokenVersion,
    });
    return {
      ...access,
      clientType: result.clientType,
      ...(result.kind === 'rotated' && { refreshToken: result.refreshToken }),
    };
  },

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await sessionService.revokeSession(sessionId, 'logout', userId);
    await auditService.record({ actorId: userId, action: 'auth.logout', resource: 'session', resourceId: sessionId, result: 'success', meta });
  },

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    const revoked = await sessionService.revokeAllForUser(userId, 'logout_all');
    await UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
    await auditService.record({
      actorId: userId,
      action: 'auth.logout_all',
      resource: 'user',
      resourceId: userId,
      result: 'success',
      metadata: { sessionsRevoked: revoked },
      meta,
    });
  },

  async me(userId: string) {
    const user = await UserModel.findById(userId).lean();
    if (!user) throw ApiError.unauthenticated();
    return { ...toPublicUser(user), isSuperAdmin: await platformAdminService.isSuperAdmin(userId) };
  },

  /** Issues a fresh verification link. Used by resend, and by invitations/user creation in Phase 2. */
  async sendVerificationEmail(user: Pick<UserDocument, '_id' | 'email' | 'firstName'>): Promise<void> {
    const token = await createOneTimeToken(
      EmailVerificationTokenModel,
      user._id,
      env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    );
    mailer.sendInBackground({
      to: user.email,
      subject: 'Verify your Lekho email address',
      text: `Hi ${user.firstName},\n\nConfirm your email address to finish setting up your Lekho account:\n\n${link('/verify-email', token)}\n\nThis link expires in ${env.EMAIL_VERIFICATION_TTL_HOURS} hours. If you didn't expect this email, you can ignore it.`,
    });
  },

  async verifyEmail({ token }: TokenOnlyInput, meta: RequestMeta): Promise<void> {
    const userId = await consumeOneTimeToken(EmailVerificationTokenModel, token);
    const user = await UserModel.findById(userId);
    if (!user || user.status === 'deleted') throw ApiError.badRequest('This link is invalid or has expired.');
    user.emailVerified = true;
    if (user.status === 'pending_verification') user.status = 'active';
    await user.save();
    await auditService.record({ actorId: String(userId), action: 'auth.email_verified', resource: 'user', resourceId: String(userId), result: 'success', meta });
  },

  /** Always resolves the same way, whether or not the email exists (FRD §14.3). */
  async resendVerification({ email }: EmailOnlyInput): Promise<void> {
    const user = await UserModel.findOne({ normalizedEmail: normalizeEmail(email) });
    if (!user || user.emailVerified || !['pending_verification', 'active'].includes(user.status)) return;
    await this.sendVerificationEmail(user);
  },

  async forgotPassword({ email }: EmailOnlyInput, meta: RequestMeta): Promise<void> {
    const user = await UserModel.findOne({ normalizedEmail: normalizeEmail(email) });
    if (!user || ['deleted', 'suspended', 'inactive'].includes(user.status)) return;
    const token = await createOneTimeToken(PasswordResetTokenModel, user._id, env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    mailer.sendInBackground({
      to: user.email,
      subject: 'Reset your Lekho password',
      text: `Hi ${user.firstName},\n\nWe received a request to reset your Lekho password. Use this link to choose a new one:\n\n${link('/reset-password', token)}\n\nThis link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once. If you didn't ask for this, you can ignore this email; your password won't change.`,
    });
    await auditService.record({ actorId: String(user._id), action: 'auth.password_reset_requested', resource: 'user', resourceId: String(user._id), result: 'success', meta });
  },

  /**
   * Account activation for identities created without an invitation (platform staff): a one-time
   * link to choose a password, valid for 72 hours, redeemed via POST /auth/reset-password.
   */
  async sendAccountSetupEmail(user: Pick<UserDocument, '_id' | 'email' | 'firstName'>, context: string): Promise<void> {
    const token = await createOneTimeToken(PasswordResetTokenModel, user._id, 72 * 60 * 60 * 1000);
    mailer.sendInBackground({
      to: user.email,
      subject: 'Set up your Lekho account',
      text: `Hi ${user.firstName},\n\n${context}\n\nChoose your password to activate your account:\n\n${link('/set-password', token)}\n\nThis link expires in 72 hours and can be used once.`,
    });
  },

  async resetPassword({ token, password }: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const userId = await consumeOneTimeToken(PasswordResetTokenModel, token);
    const user = await UserModel.findById(userId);
    if (!user || ['deleted', 'suspended', 'inactive'].includes(user.status)) {
      throw ApiError.badRequest('This link is invalid or has expired.');
    }

    const passwordHash = await passwordService.hash(password);
    await CredentialModel.updateOne(
      { userId },
      {
        $set: { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0 },
        $unset: { lockedUntil: 1 },
        $setOnInsert: { userId },
      },
      { upsert: true },
    );

    // Completing a reset proves control of the mailbox. It also activates staff accounts set up
    // through `sendAccountSetupEmail`.
    user.emailVerified = true;
    if (user.status === 'pending_verification' || user.status === 'invited') user.status = 'active';
    user.tokenVersion += 1;
    await user.save();
    const revoked = await sessionService.revokeAllForUser(String(userId), 'password_reset');

    await auditService.record({
      actorId: String(userId),
      action: 'auth.password_reset',
      resource: 'user',
      resourceId: String(userId),
      result: 'success',
      metadata: { sessionsRevoked: revoked },
      meta,
    });
    mailer.sendInBackground({
      to: user.email,
      subject: 'Your Lekho password was changed',
      text: `Hi ${user.firstName},\n\nYour Lekho password was just reset and all devices were signed out. If this wasn't you, contact your administrator immediately.`,
    });
  },

  async changePassword(userId: string, sessionId: string, input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
    const credential = await CredentialModel.findOne({ userId });
    const valid = credential && (await passwordService.verify(credential.passwordHash, input.currentPassword));
    if (!credential || !valid) {
      await auditService.record({ actorId: userId, action: 'auth.password_changed', resource: 'user', resourceId: userId, result: 'failure', metadata: { reason: 'bad_current_password' }, meta });
      throw new ApiError('INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    if (await passwordService.verify(credential.passwordHash, input.newPassword)) {
      throw ApiError.badRequest('New password must be different from the current password.');
    }

    credential.passwordHash = await passwordService.hash(input.newPassword);
    credential.passwordChangedAt = new Date();
    await credential.save();
    // Keep this device signed in; sign out every other one.
    const revoked = await sessionService.revokeAllForUser(userId, 'password_changed', { exceptSessionId: sessionId });

    await auditService.record({
      actorId: userId,
      action: 'auth.password_changed',
      resource: 'user',
      resourceId: userId,
      result: 'success',
      metadata: { otherSessionsRevoked: revoked },
      meta,
    });
    const user = await UserModel.findById(userId).lean();
    if (user) {
      mailer.sendInBackground({
        to: user.email,
        subject: 'Your Lekho password was changed',
        text: `Hi ${user.firstName},\n\nYour Lekho password was just changed and your other devices were signed out. If this wasn't you, reset your password and contact your administrator.`,
      });
    }
  },

  async listSessions(userId: string, currentSessionId: string) {
    return sessionService.listActive(userId, currentSessionId);
  },

  async revokeSession(userId: string, targetSessionId: string, meta: RequestMeta): Promise<void> {
    if (!Types.ObjectId.isValid(targetSessionId) || !(await sessionService.revokeSession(targetSessionId, 'user_revoked', userId))) {
      throw ApiError.notFound('Session not found');
    }
    await auditService.record({ actorId: userId, action: 'auth.session_revoked', resource: 'session', resourceId: targetSessionId, result: 'success', meta });
  },

  async security(userId: string) {
    const [user, credential, activeSessions] = await Promise.all([
      UserModel.findById(userId).lean(),
      CredentialModel.findOne({ userId }).lean(),
      SessionModel.countDocuments({ userId, status: 'active', expiresAt: { $gt: new Date() } }),
    ]);
    if (!user) throw ApiError.unauthenticated();
    return {
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt ?? null,
      passwordChangedAt: credential?.passwordChangedAt ?? null,
      activeSessions,
      mfa: { available: false, enabled: false },
    };
  },
};
