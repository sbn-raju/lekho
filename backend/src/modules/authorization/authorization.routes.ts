import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { ORGANIZATION_HEADER } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { objectId } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireAuth } from '../../common/utils/request.js';
import { platformAdminService } from '../platform/platform-admin.model.js';
import { authorizationService, grantedCodes } from './authorization.service.js';

const checkSchema = z.object({
  permission: z.string().min(1).max(100),
  organizationId: objectId.optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(50).optional(),
});

/**
 * POST /authorization/check — for UI hints and diagnostics only (FRD §12.8). It answers for the
 * caller only, and never replaces the guards on the real endpoints.
 */
export const authorizationRouter = Router();
authorizationRouter.post('/check', authenticate, validate({ body: checkSchema }), async (req, res) => {
  const { userId, activeOrganizationId } = requireAuth(req);
  const result = await authorizationService.check({
    userId,
    ...req.body,
    organizationId: req.body.organizationId ?? req.get(ORGANIZATION_HEADER) ?? activeOrganizationId,
  });
  sendSuccess(res, result);
});

/**
 * GET /users/me/access-context — everything the UI needs to decide what to show: platform
 * permissions, and roles/permissions in the selected organization (if any and if usable).
 */
export const accessContextHandler: RequestHandler = async (req, res) => {
  const { userId, activeOrganizationId } = requireAuth(req);
  const organizationId = req.get(ORGANIZATION_HEADER) ?? activeOrganizationId;
  const platform = await authorizationService.platformGrants(userId);
  let organization = null;
  if (organizationId) {
    const { grants, denial } = await authorizationService.organizationGrants(userId, organizationId);
    organization = {
      id: organizationId,
      usable: !denial,
      ...(denial && { reason: denial }),
      roles: denial ? [] : grants.roles,
      allPermissions: !denial && grants.all,
      permissions: denial ? [] : grantedCodes(grants),
    };
  }
  sendSuccess(res, {
    userId,
    isSuperAdmin: await platformAdminService.isSuperAdmin(userId),
    platform: { roles: platform.roles, allPermissions: platform.all, permissions: grantedCodes(platform) },
    organization,
  });
};
