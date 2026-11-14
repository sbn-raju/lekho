import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requirePermission as can } from '../authorization/permission.guard.js';
import { permissionService } from './permission.service.js';

/**
 * Organization-level permission catalog (FRD §12.7), read-only. The catalog is defined in code
 * (permission.catalog.ts); nobody can create or edit permissions through the API.
 */
const router = Router();
router.use(authenticate, organizationContext, can('permissions.read'));

router.get('/', async (req, res) => {
  const module = typeof req.query.module === 'string' ? req.query.module : undefined;
  sendSuccess(res, await permissionService.list('organization', { module }));
});
router.get('/modules', (_req, res) => {
  sendSuccess(res, permissionService.modules('organization'));
});
router.get('/:id', validate({ params: idParams }), async (req: Request<{ id: string }>, res) => {
  sendSuccess(res, await permissionService.get('organization', req.params.id));
});

export default router;
