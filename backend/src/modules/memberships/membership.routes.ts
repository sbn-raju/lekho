import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requestMeta, requireAuth, requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can, requireScope, scopedMembershipFilter } from '../authorization/permission.guard.js';
import { userService } from '../users/user.service.js';
import { createOrgUserSchema } from '../users/user.validators.js';
import { membershipService } from './membership.service.js';
import { activeOrganizationSchema, listMembershipsQuery, membershipStatusSchema, updateMembershipSchema } from './membership.validators.js';

type Id = { id: string };
const on = (code: string) => [can(code), requireScope(code, 'id', 'Membership not found')];

/** Organization membership administration (FRD §12.5). */
export const membershipRouter = Router();
membershipRouter.use(authenticate, organizationContext);

/**
 * Adding someone always goes through an invitation, so nobody joins a school without consenting.
 * Same behaviour as POST /users and POST /invitations.
 */
membershipRouter.post('/', can('users.create'), validate({ body: createOrgUserSchema }), async (req, res) => {
  sendSuccess(res, await userService.create(await orgActor(req), { ...req.body, sendInvitation: true }), 'Invitation sent', 201);
});

membershipRouter.get('/', can('memberships.read'), validate({ query: listMembershipsQuery }), async (req, res) => {
  const scope = await scopedMembershipFilter(req, 'memberships.read', 'membership');
  sendSuccess(res, await membershipService.list(requireOrg(req).organizationId, req.query as never, scope));
});

membershipRouter.get('/:id', validate({ params: idParams }), ...on('memberships.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await membershipService.get(requireOrg(req).organizationId, req.params.id));
});

// Changing roleIds additionally requires roles.assign (checked in the service).
membershipRouter.patch('/:id', validate({ params: idParams, body: updateMembershipSchema }), ...on('memberships.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await membershipService.update(await orgActor(req), req.params.id, req.body), 'Membership updated');
});

membershipRouter.patch('/:id/status', validate({ params: idParams, body: membershipStatusSchema }), ...on('memberships.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await membershipService.changeStatus(await orgActor(req), req.params.id, req.body.status), 'Status updated');
});

membershipRouter.delete('/:id', validate({ params: idParams }), ...on('memberships.delete'), async (req: Request<Id>, res) => {
  await membershipService.revoke(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'Membership revoked');
});

/** Current user's organizations (FRD §12.5 /me/*). Needs only authentication, not an org context. */
export const meRouter = Router();
meRouter.use(authenticate);

meRouter.get('/memberships', async (req, res) => {
  sendSuccess(res, await membershipService.listMine(requireAuth(req).userId));
});

meRouter.post('/active-organization', validate({ body: activeOrganizationSchema }), async (req, res) => {
  const { userId, sessionId } = requireAuth(req);
  sendSuccess(res, await membershipService.setActiveOrganization(userId, sessionId, req.body.organizationId, requestMeta(req)), 'Organization selected');
});
