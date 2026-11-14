/**
 * Thin fetch wrapper for the Lekho backend (Express, mounted at /api/v1).
 *
 * In development Vite proxies `/api` to the backend (see vite.config.ts), so
 * the default base URL works without CORS. Set VITE_API_BASE_URL to point at a
 * different backend (e.g. in production).
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');

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
}

/** Mirrors backend/src/common/utils/apiResponse.ts */
export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, { body, headers, ...init }: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const error = payload?.error;
    throw new ApiError(res.status, error?.code ?? 'UNKNOWN', error?.message ?? res.statusText, error?.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    request<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'DELETE' }),
};

export interface HealthResponse {
  success: boolean;
  status: 'ok';
  uptime: number;
  database: 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'unknown';
  timestamp: string;
}

export const getHealth = (signal?: AbortSignal) => api.get<HealthResponse>('/health', { signal });
