import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrganizationId } from '@/services/auth/organization-context';
import { api, qs } from './client';
import { keys } from './keys';
import type {
  EffectivePermissions,
  Invitation,
  Membership,
  Organization,
  OrganizationSettings,
  OrganizationUnit,
  OrgUser,
  Paginated,
  RoleRef,
  UnitDetail,
  UnitMember,
  UnitTreeNode,
  UnitType,
} from '@/types/api';

/** Everything here runs in the active school (sent as X-Organization-Id by the client). */
export interface UserFilters {
  page: number;
  search?: string;
  status?: string;
  roleId?: string;
  unitId?: string;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  roleIds?: string[];
  sendInvitation?: boolean;
  invitationExpiryDays?: number;
}

export const schoolApi = {
  organization: () => api.get<Organization>('/organizations/me'),
  updateOrganization: (id: string, body: Partial<Pick<Organization, 'name' | 'contact' | 'address'>>) => api.patch<Organization>(`/organizations/${id}`, body),
  updateSettings: (id: string, body: Partial<OrganizationSettings>) => api.patch<OrganizationSettings>(`/organizations/${id}/settings`, body),

  users: (f: UserFilters) => api.get<Paginated<OrgUser>>(`/users${qs({ limit: 20, ...f })}`),
  user: (id: string) => api.get<OrgUser>(`/users/${id}`),
  createUser: (body: CreateUserInput) =>
    api.post<{ user: { id: string; email: string }; membership: Membership; invitation: Invitation | null; existingIdentity: boolean }>('/users', body),
  updateUser: (id: string, body: { firstName?: string; lastName?: string; phone?: string | null }) => api.patch(`/users/${id}`, body),
  setUserStatus: (id: string, status: 'active' | 'suspended' | 'inactive') => api.patch(`/users/${id}/status`, { status }),
  removeUser: (id: string) => api.delete(`/users/${id}`),
  inviteUser: (id: string) => api.post<Invitation>(`/users/${id}/invite`, {}),
  resendUserInvitation: (id: string) => api.post<Invitation>(`/users/${id}/resend-invitation`),
  userRoles: (id: string) => api.get<RoleRef[]>(`/users/${id}/roles`),
  assignRole: (id: string, roleId: string) => api.post<RoleRef[]>(`/users/${id}/roles`, { roleId }),
  removeRole: (id: string, roleId: string) => api.delete<RoleRef[]>(`/users/${id}/roles/${roleId}`),
  userPermissions: (id: string) => api.get<EffectivePermissions>(`/users/${id}/permissions`),
  updateMembership: (id: string, body: { expiresAt?: string | null }) => api.patch<Membership>(`/memberships/${id}`, body),

  invitations: (f: { page: number; status?: string }) => api.get<Paginated<Invitation>>(`/invitations${qs({ limit: 20, ...f })}`),
  resendInvitation: (id: string) => api.post<Invitation>(`/invitations/${id}/resend`, {}),
  revokeInvitation: (id: string) => api.delete(`/invitations/${id}`),

  unitTree: () => api.get<UnitTreeNode[]>('/organization-units/tree'),
  units: () => api.get<OrganizationUnit[]>('/organization-units'),
  unit: (id: string) => api.get<UnitDetail>(`/organization-units/${id}`),
  createUnit: (body: { name: string; code: string; type: UnitType; parentId?: string | null; description?: string }) =>
    api.post<OrganizationUnit>('/organization-units', body),
  updateUnit: (id: string, body: { name?: string; code?: string; description?: string | null; status?: 'active' | 'inactive'; parentId?: string | null }) =>
    api.patch<UnitDetail>(`/organization-units/${id}`, body),
  deleteUnit: (id: string) => api.delete(`/organization-units/${id}`),
  unitMembers: (id: string, page: number, includeDescendants = false) =>
    api.get<Paginated<UnitMember>>(`/organization-units/${id}/members${qs({ page, limit: 20, includeDescendants })}`),
  addUnitMember: (id: string, userId: string, head?: boolean) => api.post<UnitDetail>(`/organization-units/${id}/members`, { userId, head }),
  removeUnitMember: (id: string, userId: string) => api.delete<UnitDetail>(`/organization-units/${id}/members/${userId}`),
};

export function useSchool() {
  const orgId = useActiveOrganizationId();
  return useQuery({ queryKey: keys.org('profile'), queryFn: schoolApi.organization, enabled: !!orgId });
}

export function useSchoolUsers(f: UserFilters, enabled = true) {
  return useQuery({ queryKey: keys.org('users', 'list', f), queryFn: () => schoolApi.users(f), placeholderData: keepPreviousData, enabled });
}

export function useSchoolUser(id: string) {
  return useQuery({ queryKey: keys.org('users', id), queryFn: () => schoolApi.user(id) });
}

export function useUserPermissions(id: string) {
  return useQuery({ queryKey: keys.org('users', id, 'permissions'), queryFn: () => schoolApi.userPermissions(id) });
}

export function useInvitations(f: { page: number; status?: string }, enabled = true) {
  return useQuery({ queryKey: keys.org('invitations', f), queryFn: () => schoolApi.invitations(f), placeholderData: keepPreviousData, enabled });
}

export function useUnitTree() {
  return useQuery({ queryKey: keys.org('units', 'tree'), queryFn: schoolApi.unitTree });
}

export function useUnits(enabled = true) {
  return useQuery({ queryKey: keys.org('units', 'list'), queryFn: schoolApi.units, enabled, staleTime: 60_000 });
}

export function useUnit(id: string | null) {
  return useQuery({ queryKey: keys.org('units', id), queryFn: () => schoolApi.unit(id!), enabled: !!id });
}

export function useUnitMembers(id: string | null, page: number) {
  return useQuery({ queryKey: keys.org('units', id, 'members', page), queryFn: () => schoolApi.unitMembers(id!, page), enabled: !!id, placeholderData: keepPreviousData });
}

/** Any school mutation; refreshes the active school's cached data afterwards. */
export function useSchoolMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });
}
