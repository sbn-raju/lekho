import { z } from 'zod';
import { objectId, paginationQuery } from '../../common/utils/pagination.js';

const permissionRef = z.string().trim().min(1).max(100);
const scopeRule = z.object({
  type: z.enum(['organization', 'department', 'class', 'section', 'assigned', 'own', 'custom']),
  resourceIds: z.array(objectId).max(200).optional(),
});
/** A bare reference = organization-wide; or { permission, scopes } for narrower grants. */
const permissionEntry = z.union([permissionRef, z.object({ permission: permissionRef, scopes: z.array(scopeRule).min(1).max(20) })]);
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, digits and underscores, starting with a letter')
  .max(60);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: code.optional(),
  description: z.string().trim().max(500).optional(),
  level: z.number().int().min(2).max(1000).optional(),
  /** Permission IDs or codes from the catalog, optionally with scopes. */
  permissions: z.array(permissionEntry).max(500).optional(),
});

export const updateRoleSchema = createRoleSchema
  .omit({ code: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const roleStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export const rolePermissionsSchema = z.object({ permissions: z.array(permissionEntry).min(1).max(500) });
export const roleScopesSchema = z.object({
  permissions: z.array(z.object({ permission: permissionRef, scopes: z.array(scopeRule).min(1).max(20) })).min(1).max(500),
});
export const cloneRoleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: code.optional(),
  description: z.string().trim().max(500).optional(),
});
export const listRolesQuery = z.object({ status: z.enum(['active', 'inactive']).optional() });
export const roleHoldersQuery = paginationQuery;
export const rolePermissionParams = z.object({ id: objectId, permissionId: permissionRef });
export const assignRoleSchema = z.object({ roleId: objectId });
export const userRoleParams = z.object({ id: objectId, roleId: objectId });
