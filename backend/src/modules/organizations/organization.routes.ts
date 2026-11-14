import { Router, type Request, type RequestHandler } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { requirePermission } from '../authorization/permission.guard.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requestMeta, requireAuth, requireOrg } from '../../common/utils/request.js';
import { organizationService } from './organization.service.js';
import { organizationUnitService } from '../organization-units/organization-unit.service.js';
import { updateOrganizationSelfSchema, updateSettingsSchema } from './organization.validators.js';

type Id = { id: string };

/** `:id` must be the organization in context; anything else is a cross-tenant attempt. */
const sameTenant: RequestHandler<Id> = (req, _res, next) => {
  if (req.params.id !== requireOrg(req).organizationId) {
    throw new ApiError('TENANT_MISMATCH', 'You are not a member of this organization.');
  }
  next();
};

const router = Router();
router.use(authenticate, organizationContext);

router.get('/me', async (req, res) => {
  sendSuccess(res, await organizationService.getForMember(requireOrg(req).organizationId));
});

router.get('/:id', validate({ params: idParams }), sameTenant, async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.getForMember(req.params.id));
});

router.patch('/:id', validate({ params: idParams, body: updateOrganizationSelfSchema }), sameTenant, requirePermission('settings.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.updateForAdmin(req.params.id, req.body, requireAuth(req).userId, requestMeta(req)), 'Organization updated');
});

router.get('/:id/settings', validate({ params: idParams }), sameTenant, async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.getSettings(req.params.id));
});

router.patch('/:id/settings', validate({ params: idParams, body: updateSettingsSchema }), sameTenant, requirePermission('settings.update'), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationService.updateSettings(req.params.id, req.body, requireAuth(req).userId, requestMeta(req)), 'Settings updated');
});

/** FRD §12.3: the hierarchy tree (same data as GET /organization-units/tree). */
router.get('/:id/hierarchy', validate({ params: idParams }), sameTenant, requirePermission('organization_units.read'), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationUnitService.tree(req.params.id));
});

export default router;
