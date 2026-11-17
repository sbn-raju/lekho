import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams, objectId, paginationQuery } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can, scopedMembershipFilter } from '../authorization/permission.guard.js';
import { ORGANIZATION_UNIT_TYPES } from './organization-unit.model.js';
import { organizationUnitService } from './organization-unit.service.js';

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]+$/, 'Letters, digits, hyphen and underscore').min(1).max(40);

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  code,
  type: z.enum(ORGANIZATION_UNIT_TYPES),
  parentId: objectId.nullable().optional(),
  description: z.string().trim().max(500).optional(),
});

/** `parentId` in a PATCH moves the unit (null = to the top level). */
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    code: code.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    parentId: objectId.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const listQuery = z.object({
  type: z.enum(ORGANIZATION_UNIT_TYPES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  parentId: z.union([objectId, z.literal('root')]).optional(),
});

const membersQuery = paginationQuery.extend({ includeDescendants: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
const addMemberSchema = z.object({ userId: objectId, head: z.boolean().optional() });
const memberParams = z.object({ id: objectId, userId: objectId });

type Id = { id: string };
const orgId = (req: Request) => requireOrg(req).organizationId;

/**
 * Organizational hierarchy (FRD §11, §12.9). Read access is organization-wide; writes are checked
 * against the actor's scope: a department-scoped administrator manages only their subtree.
 */
const router = Router();
router.use(authenticate, organizationContext);

router.get('/', can('organization_units.read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.query as z.infer<typeof listQuery>;
  sendSuccess(res, await organizationUnitService.list(orgId(req), { ...q, parentId: q.parentId === 'root' ? null : q.parentId }));
});
router.get('/tree', can('organization_units.read'), async (req, res) => {
  sendSuccess(res, await organizationUnitService.tree(orgId(req)));
});
router.post('/', can('organization_units.create'), validate({ body: createSchema }), async (req, res) => {
  sendSuccess(res, await organizationUnitService.create(await orgActor(req), req.body), 'Unit created', 201);
});
router.get('/:id', can('organization_units.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationUnitService.get(orgId(req), req.params.id));
});
router.patch('/:id', can('organization_units.update'), validate({ params: idParams, body: updateSchema }), async (req: Request<Id>, res) => {
  const { parentId, ...rest } = req.body as z.infer<typeof updateSchema>;
  const ctx = await orgActor(req);
  let result = Object.keys(rest).length ? await organizationUnitService.update(ctx, req.params.id, rest) : undefined;
  if (parentId !== undefined) result = await organizationUnitService.move(ctx, req.params.id, parentId);
  sendSuccess(res, result, 'Unit updated');
});
router.delete('/:id', can('organization_units.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await organizationUnitService.remove(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'Unit deleted');
});
router.get('/:id/members', can('organization_units.read', 'users.read'), validate({ params: idParams, query: membersQuery }), async (req: Request<Id>, res) => {
  const scope = await scopedMembershipFilter(req, 'users.read', 'user');
  sendSuccess(res, await organizationUnitService.members(orgId(req), req.params.id, req.query as never, scope));
});
router.post('/:id/members', can('organization_units.assign'), validate({ params: idParams, body: addMemberSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await organizationUnitService.addMember(await orgActor(req), req.params.id, req.body), 'Member assigned');
});
router.delete('/:id/members/:userId', can('organization_units.assign'), validate({ params: memberParams }), async (req: Request<{ id: string; userId: string }>, res) => {
  sendSuccess(res, await organizationUnitService.removeMember(await orgActor(req), req.params.id, req.params.userId), 'Member removed');
});

export default router;
