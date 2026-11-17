import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/services/auth/auth-context';
import { setActiveOrganizationId, useActiveOrganizationId } from '@/services/auth/organization-context';
import { api } from './client';
import { keys } from './keys';
import type { AccessContext, MyMembership } from '@/types/api';

/** The signed-in user's schools (FRD §12.5 GET /me/memberships). */
export function useMyMemberships() {
  const { state } = useAuth();
  return useQuery({
    queryKey: keys.myMemberships,
    queryFn: () => api.get<MyMembership[]>('/me/memberships', { withoutOrganization: true }),
    enabled: state.status === 'authenticated',
  });
}

/**
 * What the current user may do — platform permissions, plus the selected school's roles and
 * permissions. Used only to shape the UI; the backend enforces every permission itself.
 */
export function useAccessContext() {
  const { state } = useAuth();
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.accessContext(orgId),
    queryFn: () => api.get<AccessContext>('/users/me/access-context'),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  });
}

export interface Access {
  ready: boolean;
  isSuperAdmin: boolean;
  /** Any platform permission at all (Super Admin or platform staff). */
  hasPlatformAccess: boolean;
  canPlatform: (code: string) => boolean;
  canOrg: (code: string) => boolean;
  /** Permission is held, but only for part of the school (department, class, own…). */
  orgPermissions: Set<string>;
}

export function useAccess(): Access {
  const { data } = useAccessContext();
  const platform = new Set(data?.platform.permissions ?? []);
  const org = new Set(data?.organization?.usable ? data.organization.permissions : []);
  return {
    ready: !!data,
    isSuperAdmin: !!data?.isSuperAdmin,
    hasPlatformAccess: platform.size > 0,
    canPlatform: (code) => platform.has(code),
    canOrg: (code) => org.has(code),
    orgPermissions: org,
  };
}

/** Selects the school this tab works in, and records it on the server session too. */
export function useSelectOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      await api.post('/me/active-organization', { organizationId }, { withoutOrganization: true });
      return organizationId;
    },
    onSuccess: (organizationId) => {
      setActiveOrganizationId(organizationId);
      void qc.invalidateQueries({ queryKey: ['access-context'] });
    },
  });
}
