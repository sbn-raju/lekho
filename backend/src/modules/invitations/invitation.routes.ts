import { Router, type Request } from 'express';
import { authenticate, optionalAuthenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { rateLimits } from '../../common/middleware/rate-limit.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requestMeta, requireAuth, requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can } from '../authorization/permission.guard.js';
import { userService } from '../users/user.service.js';
import { createOrgUserSchema } from '../users/user.validators.js';
import { invitationService } from './invitation.service.js';
import { acceptInvitationSchema, listInvitationsQuery, previewInvitationSchema, resendInvitationSchema } from './invitation.validators.js';

type Id = { id: string };

/** Invitations (FRD §12.10). Preview and accept are public (token-authorized); the rest are org-admin. */
const router = Router();

// Token in the body, not the URL, so it never lands in access logs.
router.post('/preview', rateLimits.tokenRedemption, validate({ body: previewInvitationSchema }), async (req, res) => {
  sendSuccess(res, await invitationService.preview(req.body.token));
});

router.post('/accept', rateLimits.tokenRedemption, optionalAuthenticate, validate({ body: acceptInvitationSchema }), async (req, res) => {
  sendSuccess(res, await invitationService.accept(req.body, req.auth?.userId, requestMeta(req)), 'Invitation accepted');
});

const inOrg = [authenticate, organizationContext];

router.get('/', ...inOrg, can('invitations.read'), validate({ query: listInvitationsQuery }), async (req, res) => {
  sendSuccess(res, await invitationService.list(requireOrg(req).organizationId, req.query as never));
});

router.post('/', ...inOrg, can('invitations.create'), validate({ body: createOrgUserSchema }), async (req, res) => {
  const result = await userService.create(await orgActor(req), { ...req.body, sendInvitation: true });
  sendSuccess(res, result, 'Invitation sent', 201);
});

router.post('/:id/resend', ...inOrg, can('invitations.create'), validate({ params: idParams, body: resendInvitationSchema }), async (req: Request<Id>, res) => {
  const result = await invitationService.resend(
    requireOrg(req).organizationId,
    req.params.id,
    requireAuth(req).userId,
    requestMeta(req),
    req.body.invitationExpiryDays,
  );
  sendSuccess(res, result, 'Invitation re-sent');
});

router.delete('/:id', ...inOrg, can('invitations.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await invitationService.revoke(requireOrg(req).organizationId, req.params.id, requireAuth(req).userId, requestMeta(req));
  sendSuccess(res, null, 'Invitation revoked');
});

export default router;
