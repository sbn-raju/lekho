import type { PermissionLevel } from '@/types/api';

/** The role-management permission for a level: roles.* in schools, platform_roles.* on the platform. */
export const rolePermission = (level: PermissionLevel, action: 'read' | 'create' | 'update' | 'delete') =>
  level === 'platform' ? `platform_roles.${action}` : `roles.${action}`;
