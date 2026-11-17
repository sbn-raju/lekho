import { Router, type Request } from 'express';
import type { z } from 'zod';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { idParams } from '../../common/utils/pagination.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { orgActor, requirePermission as can } from '../authorization/permission.guard.js';
import { academicYearService } from './academic-year.service.js';
import { academicsOverviewService } from './academics-overview.service.js';
import { classService } from './class.service.js';
import { sectionService } from './section.service.js';
import * as v from './academics.validators.js';

type Id = { id: string };
const orgId = (req: Request) => requireOrg(req).organizationId;

/**
 * Academic structure: academic years (with terms), classes, and the sections of each class per
 * year with their strength and class teacher. All routes are tenant-scoped; section edits are
 * additionally checked against the actor's class / section scope.
 */

// ---------- /academic-years ----------
export const academicYearRouter = Router();
academicYearRouter.use(authenticate, organizationContext);

academicYearRouter.get('/', can('academic_years.read'), validate({ query: v.yearListQuery }), async (req, res) => {
  sendSuccess(res, await academicYearService.list(orgId(req), req.query as z.infer<typeof v.yearListQuery>));
});
academicYearRouter.get('/current', can('academic_years.read'), async (req, res) => {
  sendSuccess(res, await academicYearService.current(orgId(req)));
});
academicYearRouter.post('/', can('academic_years.create'), validate({ body: v.createYearSchema }), async (req, res) => {
  sendSuccess(res, await academicYearService.create(await orgActor(req), req.body), 'Academic year created', 201);
});
academicYearRouter.get('/:id', can('academic_years.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await academicYearService.get(orgId(req), req.params.id));
});
academicYearRouter.patch('/:id', can('academic_years.update'), validate({ params: idParams, body: v.updateYearSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await academicYearService.update(await orgActor(req), req.params.id, req.body), 'Academic year updated');
});
academicYearRouter.patch('/:id/status', can('academic_years.update'), validate({ params: idParams, body: v.yearStatusSchema }), async (req: Request<Id>, res) => {
  const { status, closeCurrent } = req.body as z.infer<typeof v.yearStatusSchema>;
  sendSuccess(res, await academicYearService.changeStatus(await orgActor(req), req.params.id, status, { closeCurrent }), 'Academic year updated');
});
academicYearRouter.post('/:id/copy-structure', can('sections.create'), validate({ params: idParams, body: v.copyStructureSchema }), async (req: Request<Id>, res) => {
  const result = await academicYearService.copyStructure(await orgActor(req), req.params.id, req.body.sourceAcademicYearId);
  sendSuccess(res, result, `Copied ${result.created} section${result.created === 1 ? '' : 's'}`, 201);
});
academicYearRouter.delete('/:id', can('academic_years.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await academicYearService.remove(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'Academic year deleted');
});

// ---------- /classes ----------
export const classRouter = Router();
classRouter.use(authenticate, organizationContext);

classRouter.get('/', can('classes.read'), validate({ query: v.classListQuery }), async (req, res) => {
  sendSuccess(res, await classService.list(orgId(req), req.query as z.infer<typeof v.classListQuery>));
});
classRouter.post('/', can('classes.create'), validate({ body: v.createClassSchema }), async (req, res) => {
  sendSuccess(res, await classService.create(await orgActor(req), req.body), 'Class created', 201);
});
classRouter.post('/bulk', can('classes.create'), validate({ body: v.bulkClassesSchema }), async (req, res) => {
  const created = await classService.createMany(await orgActor(req), req.body.classes);
  sendSuccess(res, created, `${created.length} classes created`, 201);
});
classRouter.put('/order', can('classes.update'), validate({ body: v.reorderClassesSchema }), async (req, res) => {
  sendSuccess(res, await classService.reorder(await orgActor(req), req.body.classIds), 'Order saved');
});
classRouter.get('/:id', can('classes.read'), validate({ params: idParams, query: v.classGetQuery }), async (req: Request<Id>, res) => {
  sendSuccess(res, await classService.get(orgId(req), req.params.id, (req.query as z.infer<typeof v.classGetQuery>).academicYearId));
});
classRouter.patch('/:id', can('classes.update'), validate({ params: idParams, body: v.updateClassSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await classService.update(await orgActor(req), req.params.id, req.body), 'Class updated');
});
classRouter.delete('/:id', can('classes.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await classService.remove(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'Class deleted');
});

// ---------- /sections ----------
export const sectionRouter = Router();
sectionRouter.use(authenticate, organizationContext);

sectionRouter.get('/', can('classes.read'), validate({ query: v.sectionListQuery }), async (req, res) => {
  sendSuccess(res, await sectionService.list(orgId(req), req.query as z.infer<typeof v.sectionListQuery>));
});
sectionRouter.post('/', can('sections.create'), validate({ body: v.createSectionSchema }), async (req, res) => {
  sendSuccess(res, await sectionService.create(await orgActor(req), req.body), 'Section created', 201);
});
sectionRouter.post('/bulk', can('sections.create'), validate({ body: v.bulkSectionsSchema }), async (req, res) => {
  const result = await sectionService.bulkCreate(await orgActor(req), req.body);
  sendSuccess(res, result, `${result.created.length} section${result.created.length === 1 ? '' : 's'} created`, 201);
});
sectionRouter.get('/:id', can('classes.read'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  sendSuccess(res, await sectionService.get(orgId(req), req.params.id));
});
sectionRouter.patch('/:id', can('sections.update'), validate({ params: idParams, body: v.updateSectionSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await sectionService.update(await orgActor(req), req.params.id, req.body), 'Section updated');
});
// Placing the teacher in the section's unit is a hierarchy assignment, so it needs both.
sectionRouter.put('/:id/class-teacher', can('sections.update', 'organization_units.assign'), validate({ params: idParams, body: v.classTeacherSchema }), async (req: Request<Id>, res) => {
  sendSuccess(res, await sectionService.setClassTeacher(await orgActor(req), req.params.id, req.body.userId), 'Class teacher updated');
});
sectionRouter.delete('/:id', can('sections.delete'), validate({ params: idParams }), async (req: Request<Id>, res) => {
  await sectionService.remove(await orgActor(req), req.params.id);
  sendSuccess(res, null, 'Section deleted');
});

// ---------- /academics ----------
export const academicsRouter = Router();
academicsRouter.use(authenticate, organizationContext);

academicsRouter.get('/overview', can('classes.read'), validate({ query: v.overviewQuery }), async (req, res) => {
  sendSuccess(res, await academicsOverviewService.overview(orgId(req), (req.query as z.infer<typeof v.overviewQuery>).academicYearId));
});
