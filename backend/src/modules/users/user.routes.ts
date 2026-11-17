import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can, requireScope, scopedMembershipFilter } from '../authorization/permission.guard.js';
import { accessContextHandler } from '../authorization/authorization.routes.js';
import { assignRoleSchema, userRoleParams } from '../roles/role.validators.js';
import { userService } from './user.service.js';
import { createOrgUserSchema, inviteUserSchema, listOrgUsersQuery, updateOrgUserSchema, userStatusSchema } from './user.validators.js';

type Id = { id: string };
const orgId = (req: Request) => requireOrg(req).organizationId;
const NF = 'User not found';
/** Permission + scope for the user in `:id`. */
const on = (code: string) => [can(code), requireScope(code, 'id', NF)];

/** Organization user management (FRD §12.4). Every route acts within the caller's organization. */
const router = Router();

// Needs only authentication; must precede the org-scoped `/:id` routes.
router.get('/me/access-context', authenticate, accessContextHandler);

router.use(authenticate, organizationContext);

router.post('/', can('users.create'), validate({ body: createOrgUserSchema }), async (req, res) => {
  sendSuccess(res, await userService.create(await orgActor(req), req.body), 'User added', 201);
});
router.get('/', can('users.read'), validate({ query: listOrgUsersQuery }), async (req, res) => {
  const scope = await scopedMembershipFilter(req, 'users.read', 'user');
  sendSuccess(res, await userService.list(orgId(req), req.query as never, scope));
});
router.get('/:id', validate({ params: idParams }), ...on('users.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.get(orgId(req), req.params.id));
});
router.patch('/:id', validate({ params: idParams, body: updateOrgUserSchema }), ...on('users.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.update(await orgActor(req), req.params.id, req.body), 'User updated');
});
/** Removes the user from this organization. The global identity and other memberships are kept. */
router.delete('/:id', validate({ params: idParams }), ...on('users.delete'), async (req: Request<Id>, res) => {
  await userService.removeFromOrganization(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'User removed from organization');
});
/** Status within this organization (the membership), not the global account status. */
router.patch('/:id/status', validate({ params: idParams, body: userStatusSchema }), ...on('users.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.setStatus(await orgActor(req), req.params.id, req.body.status), 'Status updated');
});
router.post('/:id/invite', can('invitations.create'), validate({ params: idParams, body: inviteUserSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.invite(await orgActor(req), req.params.id, req.body.invitationExpiryDays), 'Invitation sent', 201);
});
router.post('/:id/resend-invitation', can('invitations.create'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.resendInvitation(await orgActor(req), req.params.id), 'Invitation re-sent');
});
router.get('/:id/memberships', validate({ params: idParams }), ...on('users.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.memberships(orgId(req), req.params.id));
});
router.get('/:id/roles', validate({ params: idParams }), ...on('users.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.roles(orgId(req), req.params.id));
});
router.post('/:id/roles', can('roles.assign'), validate({ params: idParams, body: assignRoleSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.assignRole(await orgActor(req), req.params.id, req.body.roleId), 'Role assigned');
});
router.delete('/:id/roles/:roleId', can('roles.assign'), validate({ params: userRoleParams }), async (req: Request<{ id: string; roleId: string }>, res) => {
  sendSuccess(res, await userService.removeRole(await orgActor(req), req.params.id, req.params.roleId), 'Role removed');
});
router.get('/:id/permissions', validate({ params: idParams }), ...on('users.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await userService.permissions(orgId(req), req.params.id));
});

export default router;
