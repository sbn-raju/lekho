import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can } from '../authorization/permission.guard.js';
import { roleService, type RoleActor, type RoleScope } from './role.service.js';
import {
  cloneRoleSchema,
  createRoleSchema,
  listRolesQuery,
  roleHoldersQuery,
  rolePermissionParams,
  rolePermissionsSchema,
  roleScopesSchema,
  roleStatusSchema,
  updateRoleSchema,
} from './role.validators.js';

type Id = { id: string };
const scope = (req: Request): RoleScope => ({ level: 'organization', organizationId: requireOrg(req).organizationId });
const actor = async (req: Request): Promise<RoleActor> => {
  const a = await orgActor(req);
  return { actorId: a.actorId, grants: a.grants, meta: a.meta };
};

/** Organization role management (FRD §8, §12.6), including the scope builder. */
const router = Router();
router.use(authenticate, organizationContext);

router.get('/', can('roles.read'), validate({ query: listRolesQuery }), async (req, res) => {
  sendSuccess(res, await roleService.list(scope(req), req.query as never));
});
router.post('/', can('roles.create'), validate({ body: createRoleSchema }), async (req, res) => {
  sendSuccess(res, await roleService.create(scope(req), await actor(req), req.body), 'Role created', 201);
});
router.get('/:id', can('roles.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.get(scope(req), req.params.id));
});
router.patch('/:id', can('roles.update'), validate({ params: idParams, body: updateRoleSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.update(scope(req), await actor(req), req.params.id, req.body), 'Role updated');
});
router.delete('/:id', can('roles.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await roleService.remove(scope(req), await actor(req), req.params.id);
  sendSuccess(res, null, 'Role deleted');
});
router.patch('/:id/status', can('roles.update'), validate({ params: idParams, body: roleStatusSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.setStatus(scope(req), await actor(req), req.params.id, req.body.status), 'Role updated');
});
router.post('/:id/permissions', can('roles.update'), validate({ params: idParams, body: rolePermissionsSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.addPermissions(scope(req), await actor(req), req.params.id, req.body.permissions), 'Permissions added');
});
router.delete('/:id/permissions/:permissionId', can('roles.update'), validate({ params: rolePermissionParams }), async (req: Request<{ id: string; permissionId: string }>, res) => {
  sendSuccess(res, await roleService.removePermission(scope(req), await actor(req), req.params.id, req.params.permissionId), 'Permission removed');
});
router.get('/:id/users', can('roles.read', 'users.read'), validate({ params: idParams, query: roleHoldersQuery }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.holders(scope(req), req.params.id, req.query as never));
});
router.post('/:id/clone', can('roles.create'), validate({ params: idParams, body: cloneRoleSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.clone(scope(req), await actor(req), req.params.id, req.body), 'Role cloned', 201);
});
router.get('/:id/scopes', can('roles.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.scopes(scope(req), req.params.id));
});

/** Scope builder (FRD §14.2 screen 6). */
router.put('/:id/scopes', can('roles.update'), validate({ params: idParams, body: roleScopesSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.setScopes(scope(req), await actor(req), req.params.id, req.body.permissions), 'Scopes updated');
});

export default router;
