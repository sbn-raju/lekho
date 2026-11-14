import type { CookieOptions, Request, Response } from 'express';
import { env, cookieSecure } from '../../config/env.js';
import type { ClientType } from '../sessions/session.model.js';

export const REFRESH_COOKIE = 'lekho_rt';
export const CSRF_COOKIE = 'lekho_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CLIENT_TYPE_HEADER = 'x-client-type';

const base = (): CookieOptions => ({
  secure: cookieSecure,
  sameSite: 'lax',
  path: '/',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

/** `X-Client-Type: mobile` opts into body-delivered refresh tokens (React Native). Default is web/cookies. */
export function clientTypeOf(req: Request): ClientType {
  return req.get(CLIENT_TYPE_HEADER)?.toLowerCase() === 'mobile' ? 'mobile' : 'web';
}

export function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base(), httpOnly: true });
}

/** Readable by the web app so it can echo the value in the X-CSRF-Token header. */
export function setCsrfCookie(res: Response, csrfToken: string) {
  res.cookie(CSRF_COOKIE, csrfToken, { ...base(), httpOnly: false });
}

export function clearAuthCookies(res: Response) {
  const { maxAge: _maxAge, ...opts } = base();
  res.clearCookie(REFRESH_COOKIE, { ...opts, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}
