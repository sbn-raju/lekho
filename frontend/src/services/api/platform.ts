import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import { keys } from './keys';
import type {
  Invitation,
  OrganizationStatus,
  Paginated,
  PlatformDashboard,
  PlatformOrganization,
  PlatformOrgMember,
  PlatformStaff,
  Session,
} from '@/types/api';

const opts = { withoutOrganization: true } as const;
const k = (...rest: unknown[]) => [...keys.platform, ...rest];

export interface OrganizationInput {
  name: string;
  slug: string;
  code: string;
  contact: { email: string; phone?: string };
  address?: { line1?: string; city?: string; state?: string; country?: string; postalCode?: string };
  settings?: { timezone?: string; academicYear?: string };
  saveAsDraft?: boolean;
}

export const platformApi = {
  dashboard: () => api.get<PlatformDashboard>('/platform/dashboard', opts),
  organizations: (f: { page: number; status?: string; search?: string }) =>
    api.get<Paginated<PlatformOrganization>>(`/platform/organizations${qs({ limit: 20, ...f })}`, opts),
  organization: (id: string) => api.get<PlatformOrganization>(`/platform/organizations/${id}`, opts),
  createOrganization: (body: OrganizationInput) => api.post<PlatformOrganization>('/platform/organizations', body, opts),
  updateOrganization: (id: string, body: Partial<OrganizationInput>) => api.patch<PlatformOrganization>(`/platform/organizations/${id}`, body, opts),
  setOrganizationStatus: (id: string, status: OrganizationStatus, reason?: string) =>
    api.patch<PlatformOrganization>(`/platform/organizations/${id}/status`, { status, reason }, opts),
  provisionAdmin: (id: string, body: { firstName: string; lastName: string; email: string; phone?: string; invitationExpiryDays?: number }) =>
    api.post<{ organization: PlatformOrganization; invitation: Invitation; idempotent: boolean }>(`/platform/organizations/${id}/admin`, body, opts),
  resendAdminInvitation: (id: string) => api.post<Invitation>(`/platform/organizations/${id}/admin/resend-invitation`, undefined, opts),
  organizationMembers: (id: string, page: number) =>
    api.get<Paginated<PlatformOrgMember>>(`/platform/organizations/${id}/memberships${qs({ page, limit: 20 })}`, opts),

  staff: (f: { page: number; search?: string; status?: string }) => api.get<Paginated<PlatformStaff>>(`/platform/users${qs({ limit: 20, ...f })}`, opts),
  createStaff: (body: { firstName: string; lastName: string; email: string; phone?: string; roleIds: string[] }) =>
    api.post<PlatformStaff>('/platform/users', body, opts),
  updateStaff: (id: string, body: { roleIds?: string[]; status?: 'active' | 'suspended' | 'inactive' }) =>
    api.patch<PlatformStaff>(`/platform/users/${id}`, body, opts),
  staffPermissions: (id: string) => api.get<{ superAdmin: boolean; permissions: string[] }>(`/platform/users/${id}/permissions`, opts),
  staffSessions: (id: string) => api.get<Session[]>(`/platform/users/${id}/sessions`, opts),
};

export const platformKeys = {
  dashboard: k('dashboard'),
  organizations: k('organizations'),
  organizationList: (f: object) => k('organizations', 'list', f),
  organization: (id: string) => k('organizations', id),
  organizationMembers: (id: string, page: number) => k('organizations', id, 'members', page),
  staff: k('staff'),
  staffList: (f: object) => k('staff', 'list', f),
  staffDetail: (id: string, what: string) => k('staff', id, what),
};

export function usePlatformDashboard() {
  return useQuery({ queryKey: platformKeys.dashboard, queryFn: platformApi.dashboard });
}

export function useOrganizations(f: { page: number; status?: string; search?: string }) {
  return useQuery({ queryKey: platformKeys.organizationList(f), queryFn: () => platformApi.organizations(f), placeholderData: keepPreviousData });
}

export function useOrganization(id: string) {
  return useQuery({ queryKey: platformKeys.organization(id), queryFn: () => platformApi.organization(id) });
}

export function useOrganizationMembers(id: string, page: number) {
  return useQuery({ queryKey: platformKeys.organizationMembers(id, page), queryFn: () => platformApi.organizationMembers(id, page), placeholderData: keepPreviousData });
}

export function usePlatformStaff(f: { page: number; search?: string; status?: string }) {
  return useQuery({ queryKey: platformKeys.staffList(f), queryFn: () => platformApi.staff(f), placeholderData: keepPreviousData });
}

/** Any platform mutation; refreshes everything under the platform key afterwards. */
export function usePlatformMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: keys.platform }) });
}
