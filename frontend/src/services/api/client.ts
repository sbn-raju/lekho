/**
 * HTTP client for the Lekho backend (Express, mounted at /api/v1).
 *
 * Session model (backend FRD §4.5, web flavour):
 *  - The access token lives only in memory (never localStorage), so XSS can't lift it from storage.
 *  - The refresh token is an HttpOnly cookie set by the server; JavaScript never sees it.
 *  - Refreshing echoes the CSRF token (readable `lekho_csrf` cookie) in `X-CSRF-Token`.
 *  - A 401 triggers one shared refresh and a single retry; parallel requests wait on the same refresh.
 *
 * In development Vite proxies `/api` to the backend (see vite.config.ts), so cookies are
 * first-party. Set VITE_API_BASE_URL to point at a different backend.
 */
import { getActiveOrganizationId } from '@/services/auth/organization-context';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
const CSRF_COOKIE = 'lekho_csrf';
const CSRF_FALLBACK_KEY = 'lekho.csrf';
/** Refresh this long before the access token expires. */
const REFRESH_EARLY_MS = 60_000;

/** Mirrors backend/src/common/middleware/error.middleware.ts: { success: false, error: { code, message, details } } */
export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable code, e.g. INVALID_CREDENTIALS, TOKEN_EXPIRED, FORBIDDEN. */
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Zod field errors from VALIDATION_ERROR responses, flattened to `{ field: 'first message' }`. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !this.details || typeof this.details !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [field, messages] of Object.entries(this.details as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === 'string') out[field] = messages[0];
    }
    return out;
  }
}

// ---------- Access token (memory only) ----------

type Listener = () => void;
let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const expiredListeners = new Set<Listener>();

export const session = {
  get token() {
    return accessToken;
  },

  set(token: string, expiresInSeconds: number, csrfToken?: string) {
    accessToken = token;
    if (csrfToken) {
      try {
        localStorage.setItem(CSRF_FALLBACK_KEY, csrfToken);
      } catch {
        /* storage unavailable: the cookie still works when same-origin */
      }
    }
    clearTimeout(refreshTimer);
    const delay = Math.max(5_000, expiresInSeconds * 1000 - REFRESH_EARLY_MS);
    refreshTimer = setTimeout(() => void refreshSession(), delay);
  },

  clear() {
    accessToken = null;
    clearTimeout(refreshTimer);
    try {
      localStorage.removeItem(CSRF_FALLBACK_KEY);
    } catch {
      /* ignore */
    }
  },

  /** Called when the session can no longer be refreshed (revoked, expired, reused token). */
  onExpired(listener: Listener) {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },
};

function readCsrf(): string | undefined {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  if (match) return decodeURIComponent(match.slice(CSRF_COOKIE.length + 1));
  try {
    // Cross-origin API: the cookie isn't readable here, so use the value from the login response.
    return localStorage.getItem(CSRF_FALLBACK_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const csrf = readCsrf();
      // No CSRF token means no session was ever started in this browser: skip the round trip.
      if (!csrf && accessToken === null) return false;
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', ...(csrf && { 'X-CSRF-Token': csrf }) },
      });
      if (!res.ok) {
        const hadSession = accessToken !== null;
        session.clear();
        if (hadSession) expiredListeners.forEach((l) => l());
        return false;
      }
      const body = await res.json();
      session.set(body.data.accessToken, body.data.expiresIn);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------- Requests ----------

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Don't send X-Organization-Id (platform and account routes don't need it). */
  withoutOrganization?: boolean;
  /** Return the raw JSON instead of `.data` (e.g. /health, which isn't enveloped). */
  raw?: boolean;
}

const NO_RETRY = new Set(['/auth/login', '/auth/refresh']);

async function send(path: string, options: RequestOptions) {
  // `raw` only affects how `request` reads the response.
  const { body, headers, withoutOrganization, raw, ...init } = options;
  void raw;
  const organizationId = withoutOrganization ? null : getActiveOrganizationId();
  return fetch(`${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...(organizationId && { 'X-Organization-Id': organizationId }),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function toError(res: Response): Promise<ApiError> {
  const payload = await res.json().catch(() => null);
  const error = payload?.error;
  return new ApiError(res.status, error?.code ?? 'UNKNOWN', error?.message ?? res.statusText, error?.details);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  // Expired or invalid access token: refresh once and retry.
  if (res.status === 401 && accessToken && !NO_RETRY.has(path)) {
    const error = await toError(res.clone());
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHENTICATED') {
      if (await refreshSession()) res = await send(path, options);
    }
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const payload = await res.json();
  return (options.raw ? payload : payload.data) as T;
}

export const api = {
  get: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'DELETE' }),

  /** Downloads a file response (e.g. CSV export) with the current credentials. */
  async download(path: string, filename: string, init?: RequestOptions) {
    let res = await send(path, { ...init, method: 'GET' });
    if (res.status === 401 && (await refreshSession())) res = await send(path, { ...init, method: 'GET' });
    if (!res.ok) throw await toError(res);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface HealthResponse {
  success: boolean;
  status: 'ok';
  uptime: number;
  database: 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'unknown';
  timestamp: string;
}

export const getHealth = (signal?: AbortSignal) => api.get<HealthResponse>('/health', { signal, raw: true, withoutOrganization: true });
