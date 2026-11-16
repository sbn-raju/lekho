import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requestMeta, requireAuth } from '../../common/utils/request.js';
import { platformActor, requirePermission } from '../authorization/permission.guard.js';
import { organizationService } from '../organizations/organization.service.js';
import { onboardingService } from '../organizations/onboarding.service.js';
import { membershipService } from '../memberships/membership.service.js';
import { listMembershipsQuery } from '../memberships/membership.validators.js';
import { roleService } from '../roles/role.service.js';
import {
  createRoleSchema,
  listRolesQuery,
  roleHoldersQuery,
  rolePermissionParams,
  rolePermissionsSchema,
  roleStatusSchema,
  updateRoleSchema,
} from '../roles/role.validators.js';
import { permissionService } from '../permissions/permission.service.js';
import { auditQueryService, auditQuerySchema } from '../audit/audit-query.service.js';
import { platformUserService } from './platform-user.service.js';
import { platformDashboardService } from './platform-dashboard.service.js';
import { createPlatformUserSchema, listPlatformUsersQuery, updatePlatformUserSchema } from './platform.validators.js';
import {
  createOrganizationSchema,
  listOrganizationsQuery,
  organizationStatusSchema,
  provisionAdminSchema,
  updateOrganizationPlatformSchema,
} from '../organizations/organization.validators.js';

type Id = { id: string };
const actor = (req: Request) => requireAuth(req).userId;
const PLATFORM = { level: 'platform' } as const;
const can = requirePermission;

/**
 * Platform administration (FRD §12.2). Every route checks a platform permission. The Super Admin
 * holds all of them; platform staff hold what their platform roles grant. Organization roles never
 * grant platform permissions, so School Admins get 403 here.
 */
const router = Router();
router.use(authenticate);

// ----- Dashboard (Super Admin console screen 1) -----
router.get('/dashboard', can('organizations.read'), async (_req, res) => {
  sendSuccess(res, await platformDashboardService.summary());
});

// ----- Organizations -----
router.post('/organizations', can('organizations.create'), validate({ body: createOrganizationSchema }), async (req, res) => {
  sendSuccess(res, await organizationService.create(req.body, actor(req), requestMeta(req)), 'Organization created', 201);
});
router.get('/organizations', can('organizations.read'), validate({ query: listOrganizationsQuery }), async (req, res) => {
  sendSuccess(res, await organizationService.list(req.query as never));
});
router.get('/organizations/:id', can('organizations.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.getForPlatform(req.params.id));
});
router.patch('/organizations/:id', can('organizations.update'), validate({ params: idParams, body: updateOrganizationPlatformSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.updateForPlatform(req.params.id, req.body, actor(req), requestMeta(req)), 'Organization updated');
});
router.patch('/organizations/:id/status', can('organizations.manage'), validate({ params: idParams, body: organizationStatusSchema }), async (req: Request<Id>, res) => {
  const { status, reason } = req.body;
  sendSuccess(res, await organizationService.changeStatus(req.params.id, status, reason, actor(req), requestMeta(req)), 'Status updated');
});
router.post('/organizations/:id/admin', can('organizations.assign'), validate({ params: idParams, body: provisionAdminSchema }), async (req: Request<Id>, res) => {
  const result = await onboardingService.provisionInitialAdmin(req.params.id, req.body, actor(req), requestMeta(req));
  sendSuccess(res, result, result.idempotent ? 'School Admin already provisioned' : 'School Admin provisioned', result.idempotent ? 200 : 201);
});
router.post('/organizations/:id/admin/resend-invitation', can('organizations.assign'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await onboardingService.resendInitialAdminInvitation(req.params.id, actor(req), requestMeta(req)), 'Invitation re-sent');
});
router.get('/organizations/:id/memberships', can('organizations.read'), validate({ params: idParams, query: listMembershipsQuery }), async (req: Request<Id>, res) => {
  await organizationService.getForPlatform(req.params.id);
  sendSuccess(res, await membershipService.listWithUsers(req.params.id, req.query as never));
});

// ----- Platform staff -----
router.get('/users', can('platform_users.read'), validate({ query: listPlatformUsersQuery }), async (req, res) => {
  sendSuccess(res, await platformUserService.list(req.query as never));
});
router.post('/users', can('platform_users.create'), validate({ body: createPlatformUserSchema }), async (req, res) => {
  sendSuccess(res, await platformUserService.create(await platformActor(req), req.body), 'Platform user added', 201);
});
router.get('/users/:id', can('platform_users.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await platformUserService.get(req.params.id));
});
router.patch('/users/:id', can('platform_users.update'), validate({ params: idParams, body: updatePlatformUserSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await platformUserService.update(await platformActor(req), req.params.id, req.body), 'Platform user updated');
});
router.get('/users/:id/permissions', can('platform_users.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await platformUserService.permissions(req.params.id));
});
router.get('/users/:id/sessions', can('platform_users.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await platformUserService.sessions(req.params.id));
});

// ----- Platform roles -----
router.get('/roles', can('platform_roles.read'), validate({ query: listRolesQuery }), async (req, res) => {
  sendSuccess(res, await roleService.list(PLATFORM, req.query as never));
});
router.post('/roles', can('platform_roles.create'), validate({ body: createRoleSchema }), async (req, res) => {
  sendSuccess(res, await roleService.create(PLATFORM, await platformActor(req), req.body), 'Role created', 201);
});
router.get('/roles/:id', can('platform_roles.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.get(PLATFORM, req.params.id));
});
router.patch('/roles/:id', can('platform_roles.update'), validate({ params: idParams, body: updateRoleSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.update(PLATFORM, await platformActor(req), req.params.id, req.body), 'Role updated');
});
router.delete('/roles/:id', can('platform_roles.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await roleService.remove(PLATFORM, await platformActor(req), req.params.id);
  sendSuccess(res, null, 'Role deleted');
});
router.patch('/roles/:id/status', can('platform_roles.update'), validate({ params: idParams, body: roleStatusSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.setStatus(PLATFORM, await platformActor(req), req.params.id, req.body.status), 'Role updated');
});
router.post('/roles/:id/permissions', can('platform_roles.update'), validate({ params: idParams, body: rolePermissionsSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.addPermissions(PLATFORM, await platformActor(req), req.params.id, req.body.permissions), 'Permissions added');
});
router.delete('/roles/:id/permissions/:permissionId', can('platform_roles.update'), validate({ params: rolePermissionParams }), async (req: Request<{ id: string; permissionId: string }>, res) => {
  sendSuccess(res, await roleService.removePermission(PLATFORM, await platformActor(req), req.params.id, req.params.permissionId), 'Permission removed');
});
router.get('/roles/:id/users', can('platform_roles.read'), validate({ params: idParams, query: roleHoldersQuery }), async (req: Request<Id>, res) => {
  sendSuccess(res, await roleService.holders(PLATFORM, req.params.id, req.query as never));
});

// ----- Permission catalog -----
router.get('/permissions', can('platform_permissions.read'), async (req, res) => {
  const level = req.query.level === 'organization' ? 'organization' : 'platform';
  sendSuccess(res, await permissionService.list(level));
});
router.get('/permissions/modules', can('platform_permissions.read'), (req, res) => {
  sendSuccess(res, permissionService.modules(req.query.level === 'organization' ? 'organization' : 'platform'));
});
router.get('/permissions/:id', can('platform_permissions.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  const level = req.query.level === 'organization' ? 'organization' : 'platform';
  sendSuccess(res, { ...(await permissionService.get(level, req.params.id)), roles: await permissionService.rolesUsing(level, req.params.id) });
});

// ----- Audit -----
router.get('/audit-logs', can('platform_audit.read'), validate({ query: auditQuerySchema }), async (req, res) => {
  sendSuccess(res, await auditQueryService.list(req.query as never));
});
router.get('/audit-logs/export', can('platform_audit.read'), validate({ query: auditQuerySchema }), async (req, res) => {
  res.type('text/csv').attachment('lekho-platform-audit.csv').send(await auditQueryService.exportCsv(req.query as never));
});
router.get('/audit-logs/:id', can('platform_audit.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await auditQueryService.get(req.params.id));
});

export default router;
