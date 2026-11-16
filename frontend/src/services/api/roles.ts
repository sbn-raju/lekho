import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import { keys } from './keys';
import type { Paginated, Permission, PermissionLevel, PermissionModule, Role, ScopeRule, User } from '@/types/api';

/** A permission reference, optionally narrowed by scopes (organization roles only). */
export type PermissionEntry = string | { permission: string; scopes: ScopeInput[] };
export type ScopeInput = { type: ScopeRule['type']; resourceIds?: string[] };

export interface RoleInput {
  name: string;
  code?: string;
  description?: string;
  level?: number;
  permissions?: PermissionEntry[];
}

/**
 * Roles and the permission catalog work the same for schools (`/roles`) and the platform
 * (`/platform/roles`); screens take the level and get the right endpoints.
 */
export function rolesApi(level: PermissionLevel) {
  const base = level === 'platform' ? '/platform/roles' : '/roles';
  const opts = level === 'platform' ? ({ withoutOrganization: true } as const) : {};
  const k = (...rest: unknown[]) => (level === 'platform' ? [...keys.platform, 'roles', ...rest] : keys.org('roles', ...rest));
  const permissionsBase = level === 'platform' ? '/platform/permissions' : '/permissions';
  const pk = (...rest: unknown[]) => (level === 'platform' ? [...keys.platform, 'permissions', ...rest] : keys.org('permissions', ...rest));
  return {
    level,
    basePath: level === 'platform' ? '/platform/roles' : '/roles',
    keys: { all: k(), role: (id: string) => k(id), holders: (id: string, page: number) => k(id, 'holders', page) },
    list: () => api.get<Role[]>(base, opts),
    get: (id: string) => api.get<Role>(`${base}/${id}`, opts),
    create: (body: RoleInput) => api.post<Role>(base, body, opts),
    update: (id: string, body: Partial<RoleInput>) => api.patch<Role>(`${base}/${id}`, body, opts),
    setStatus: (id: string, status: 'active' | 'inactive') => api.patch<Role>(`${base}/${id}/status`, { status }, opts),
    remove: (id: string) => api.delete(`${base}/${id}`, opts),
    clone: (id: string, body: { name: string }) => api.post<Role>(`${base}/${id}/clone`, body, opts),
    setScopes: (id: string, permissions: { permission: string; scopes: ScopeInput[] }[]) =>
      api.put(`${base}/${id}/scopes`, { permissions }, opts),
    holders: (id: string, page: number) => api.get<Paginated<User & { membershipStatus: string }>>(`${base}/${id}/users${qs({ page, limit: 20 })}`, opts),
    permissionKeys: { all: pk(), modules: pk('modules') },
    permissions: () =>
      api.get<Permission[]>(level === 'platform' ? `${permissionsBase}?level=platform` : permissionsBase, opts),
    modules: () => api.get<PermissionModule[]>(level === 'platform' ? `${permissionsBase}/modules?level=platform` : `${permissionsBase}/modules`, opts),
  };
}

export type RolesApi = ReturnType<typeof rolesApi>;

export function useRoles(r: RolesApi, enabled = true) {
  return useQuery({ queryKey: r.keys.all, queryFn: r.list, enabled });
}

export function useRole(r: RolesApi, id: string) {
  return useQuery({ queryKey: r.keys.role(id), queryFn: () => r.get(id) });
}

export function usePermissionCatalog(r: RolesApi) {
  return useQuery({ queryKey: r.permissionKeys.all, queryFn: r.permissions, staleTime: 5 * 60_000 });
}

export function usePermissionModules(r: RolesApi) {
  return useQuery({ queryKey: r.permissionKeys.modules, queryFn: r.modules, staleTime: 5 * 60_000 });
}

/** Wraps a role mutation so the role list and detail refresh afterwards. */
export function useRoleMutation<TArgs, TResult>(r: RolesApi, fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: r.keys.all }),
  });
}
