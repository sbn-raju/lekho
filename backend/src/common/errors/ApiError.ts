/** Error codes from FRD §18, plus a few auth-specific ones. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REUSED: 401,
  FORBIDDEN: 403,
  TENANT_MISMATCH: 403,
  MEMBERSHIP_INACTIVE: 403,
  ROLE_PROTECTED: 403,
  CSRF_INVALID: 403,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_DISABLED: 403,
  ORGANIZATION_INACTIVE: 403,
  ORGANIZATION_CONTEXT_REQUIRED: 400,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  REGISTRATION_INCOMPLETE: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  OTP_LOCKED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = ERROR_CODES[code];
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError('NOT_FOUND', message);
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError('CONFLICT', message, details);
  }
}
