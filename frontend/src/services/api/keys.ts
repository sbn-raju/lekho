import { getActiveOrganizationId } from '@/services/auth/organization-context';

/**
 * Query keys. Organization-scoped data is keyed by the active organization so switching schools
 * never shows the previous school's cache.
 */
export const keys = {
  me: ['me'] as const,
  security: ['account', 'security'] as const,
  sessions: ['account', 'sessions'] as const,
  myMemberships: ['me', 'memberships'] as const,
  accessContext: (orgId: string | null) => ['access-context', orgId] as const,

  platform: ['platform'] as const,
  org: (...rest: unknown[]) => ['org', getActiveOrganizationId(), ...rest] as const,
};
