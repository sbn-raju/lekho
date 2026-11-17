import { Router, type Request } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { requirePermission as can } from '../authorization/permission.guard.js';
import { auditQueryService, auditQuerySchema } from './audit-query.service.js';

/** Organization audit trail (FRD §12.11): always restricted to the organization in context. */
const router = Router();
router.use(authenticate, organizationContext, can('audit_logs.read'));

router.get('/', validate({ query: auditQuerySchema }), async (req, res) => {
  sendSuccess(res, await auditQueryService.list(req.query as never, requireOrg(req).organizationId));
});
router.get('/export', validate({ query: auditQuerySchema }), async (req, res) => {
  const csv = await auditQueryService.exportCsv(req.query as never, requireOrg(req).organizationId);
  res.type('text/csv').attachment('lekho-audit.csv').send(csv);
});
router.get('/:id', validate({ params: idParams }), async (req: Request<{ id: string }>, res) => {
  sendSuccess(res, await auditQueryService.get(req.params.id, requireOrg(req).organizationId));
});

export default router;
