import type { Request, Response } from 'express';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requestMeta, requireAuth } from '../../common/utils/request.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { authService, type AuthResult } from './auth.service.js';
import {
  CSRF_HEADER,
  REFRESH_COOKIE,
  clearAuthCookies,
  clientTypeOf,
  setCsrfCookie,
  setRefreshCookie,
} from './auth.cookies.js';

const GENERIC_EMAIL_RESPONSE = 'If an account exists for that email, we have sent a message to it.';

/**
 * Web: refresh token goes in an HttpOnly cookie and never reaches JavaScript.
 * Mobile: returned in the body for the app to keep in Keychain / Keystore.
 */
function authPayload(res: Response, result: AuthResult, deliverRefreshInBody: boolean) {
  if (!deliverRefreshInBody) {
    if (result.refreshToken) setRefreshCookie(res, result.refreshToken);
    if (result.csrfToken) setCsrfCookie(res, result.csrfToken);
  }
  return {
    tokenType: 'Bearer',
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    ...(deliverRefreshInBody && result.refreshToken && { refreshToken: result.refreshToken }),
    ...(!deliverRefreshInBody && result.csrfToken && { csrfToken: result.csrfToken }),
    ...(result.user && { user: result.user }),
  };
}

export const authController = {
  async login(req: Request, res: Response) {
    const clientType = clientTypeOf(req);
    const result = await authService.login(req.body, clientType, requestMeta(req));
    sendSuccess(res, authPayload(res, result, clientType === 'mobile'), 'Signed in');
  },

  async refresh(req: Request, res: Response) {
    const bodyToken: string | undefined = req.body?.refreshToken;
    const cookieToken: string | undefined = req.cookies?.[REFRESH_COOKIE];
    const fromBody = bodyToken !== undefined;
    const token = bodyToken ?? cookieToken;
    if (!token) throw ApiError.unauthenticated('No refresh token provided');

    try {
      const csrf = fromBody ? undefined : (req.get(CSRF_HEADER) ?? null);
      const result = await authService.refresh(token, csrf, requestMeta(req));
      sendSuccess(res, authPayload(res, result, fromBody), 'Token refreshed');
    } catch (err) {
      // A dead cookie is useless to the browser; clear it so the app goes straight to sign-in.
      if (!fromBody && err instanceof ApiError && err.statusCode === 401) clearAuthCookies(res);
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    const { userId, sessionId } = requireAuth(req);
    await authService.logout(userId, sessionId, requestMeta(req));
    clearAuthCookies(res);
    sendSuccess(res, null, 'Signed out');
  },

  async logoutAll(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    await authService.logoutAll(userId, requestMeta(req));
    clearAuthCookies(res);
    sendSuccess(res, null, 'Signed out of all devices');
  },

  async me(req: Request, res: Response) {
    sendSuccess(res, await authService.me(requireAuth(req).userId));
  },

  async verifyEmail(req: Request, res: Response) {
    await authService.verifyEmail(req.body, requestMeta(req));
    sendSuccess(res, null, 'Email verified');
  },

  async resendVerification(req: Request, res: Response) {
    await authService.resendVerification(req.body);
    sendSuccess(res, null, GENERIC_EMAIL_RESPONSE, 202);
  },

  async forgotPassword(req: Request, res: Response) {
    await authService.forgotPassword(req.body, requestMeta(req));
    sendSuccess(res, null, GENERIC_EMAIL_RESPONSE, 202);
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body, requestMeta(req));
    clearAuthCookies(res);
    sendSuccess(res, null, 'Password reset. Please sign in with your new password.');
  },

  async changePassword(req: Request, res: Response) {
    const { userId, sessionId } = requireAuth(req);
    await authService.changePassword(userId, sessionId, req.body, requestMeta(req));
    sendSuccess(res, null, 'Password changed. Other devices have been signed out.');
  },

  async listSessions(req: Request, res: Response) {
    const { userId, sessionId } = requireAuth(req);
    sendSuccess(res, await authService.listSessions(userId, sessionId));
  },

  async revokeSession(req: Request<{ id: string }>, res: Response) {
    const { userId, sessionId } = requireAuth(req);
    await authService.revokeSession(userId, req.params.id, requestMeta(req));
    if (req.params.id === sessionId) clearAuthCookies(res);
    sendSuccess(res, null, 'Session revoked');
  },

  async security(req: Request, res: Response) {
    sendSuccess(res, await authService.security(requireAuth(req).userId));
  },
};
