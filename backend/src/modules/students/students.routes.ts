import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { authenticate } from '../../common/middleware/authenticate.middleware.js';
import { organizationContext } from '../../common/middleware/organization-context.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { requireOrg } from '../../common/utils/request.js';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../../common/errors/ApiError.js';
import { isTest } from '../../config/env.js';
import { hasPermission } from '../authorization/authorization.service.js';
import { orgActor, requestGrants, requirePermission as can, requireScope } from '../authorization/permission.guard.js';
import { admissionService, studentSettingsService } from './admission.service.js';
import { assignmentService } from './assignment.service.js';
import { guardianService } from './guardian.service.js';
import { idCardService } from './id-card.service.js';
import { photoService } from './photo.service.js';
import { studentService, type ListQuery } from './student.service.js';
import { studentScopeFilter } from './students.shared.js';
import * as v from './students.validators.js';

type S = { studentId: string };
type G = S & { guardianId: string };
type A = S & { assignmentId: string };
const orgId = (req: Request) => requireOrg(req).organizationId;
const grants = (req: Request) => requestGrants(req, 'organization');
/** The student named by :studentId must exist here (404) and be inside the caller's scope (403). */
const inScope = (code: string) => requireScope(code, 'studentId', 'Student not found');

function sendPdf(res: Response, pdf: Buffer, fileName: string) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' });
  res.send(pdf);
}

/** Per-IP cap on OTP sends across all guardians, on top of the per-number limits in the service. */
const otpSendLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, _res, next) => next(new ApiError('RATE_LIMITED', 'Too many codes requested. Please try again later.')),
});

/**
 * Student Management (Student FRD §14). Every route is tenant-scoped. Reads are additionally
 * limited to the caller's class / section scope: per student with `inScope`, and for lists and
 * bulk operations with a server-side filter, so teachers can't reach other classes by changing
 * parameters (FRD §2.2, §16).
 */
export const studentRouter = Router();
studentRouter.use(authenticate, organizationContext, (_req, res, next) => {
  // Student records are personal data: never cache them in shared caches.
  res.set('Cache-Control', 'private, no-store');
  next();
});

// ----- Collection -----
studentRouter.get('/', can('students.read'), validate({ query: v.listStudentsQuery }), async (req, res) => {
  sendSuccess(res, await studentService.list(await grants(req), orgId(req), req.query as unknown as ListQuery));
});
studentRouter.get('/stats', can('students.read'), async (req, res) => {
  sendSuccess(res, await studentService.stats(await grants(req), orgId(req)));
});
studentRouter.get('/my-sections', can('students.read'), validate({ query: v.mySectionsQuery }), async (req, res) => {
  sendSuccess(res, await studentService.mySections(await grants(req), orgId(req), (req.query as z.infer<typeof v.mySectionsQuery>).academicYearId));
});
studentRouter.post('/', can('students.create'), validate({ body: v.createStudentSchema }), async (req, res) => {
  sendSuccess(res, await studentService.create(await orgActor(req), req.body), 'Draft registration saved', 201);
});
studentRouter.post('/bulk-promote', can('student_assignments.manage'), validate({ body: v.bulkPromoteSchema }), async (req, res) => {
  const ctx = await orgActor(req);
  const result = await assignmentService.bulkPromote(ctx, { ...req.body, scopeFilter: await studentScopeFilter(ctx.grants, 'students.read') });
  sendSuccess(res, result, `${result.placed} student${result.placed === 1 ? '' : 's'} placed`);
});
studentRouter.post('/id-cards/bulk-generate', can('student_id_cards.generate'), validate({ body: v.bulkIdCardSchema }), async (req, res) => {
  const ctx = await orgActor(req);
  const result = await idCardService.bulk(ctx, req.body, await studentScopeFilter(ctx.grants, 'student_id_cards.generate'));
  if (!result.pdf) return sendSuccess(res, result.summary);
  res.set('X-IdCards-Generated', String(result.summary.eligible));
  res.set('X-IdCards-Skipped', String(result.summary.skipped.length));
  res.set('Access-Control-Expose-Headers', 'Content-Disposition, X-IdCards-Generated, X-IdCards-Skipped');
  return sendPdf(res, result.pdf, result.fileName!);
});

// ----- One student -----
studentRouter.get('/:studentId', can('students.read'), validate({ params: v.studentIdParams }), inScope('students.read'), async (req: Request<S>, res) => {
  const ctx = await orgActor(req);
  sendSuccess(res, await studentService.get(ctx.grants, req.params.studentId, { ctx }));
});
studentRouter.get('/:studentId/profile', can('students.read'), validate({ params: v.studentIdParams }), inScope('students.read'), async (req: Request<S>, res) => {
  const ctx = await orgActor(req);
  sendSuccess(res, await studentService.profile(ctx.grants, req.params.studentId, ctx));
});
studentRouter.get('/:studentId/history', can('students.read', 'audit_logs.read'), validate({ params: v.studentIdParams, query: v.historyQuery }), inScope('students.read'), async (req: Request<S>, res) => {
  sendSuccess(res, await studentService.history(orgId(req), req.params.studentId, req.query as unknown as z.infer<typeof v.historyQuery>));
});
studentRouter.patch('/:studentId', can('students.update'), validate({ params: v.studentIdParams, body: v.updateStudentSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await studentService.update(await orgActor(req), req.params.studentId, req.body), 'Student updated');
});
studentRouter.post('/:studentId/complete-registration', can('students.create'), validate({ params: v.studentIdParams, body: v.completeRegistrationSchema }), async (req: Request<S>, res) => {
  const ctx = await orgActor(req);
  // Placing in a class at registration also needs the assignment permission.
  if (req.body.assignment && !hasPermission(ctx.grants, 'student_assignments.manage')) {
    throw new ApiError('FORBIDDEN', 'You do not have permission to assign classes.', { requiredPermission: 'student_assignments.manage' });
  }
  sendSuccess(res, await studentService.completeRegistration(ctx, req.params.studentId, req.body), 'Registration completed');
});
studentRouter.patch('/:studentId/status', can('students.update'), validate({ params: v.studentIdParams, body: v.statusSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await studentService.changeStatus(await orgActor(req), req.params.studentId, req.body), 'Status updated');
});
studentRouter.delete('/:studentId', can('students.delete'), validate({ params: v.studentIdParams, body: v.deleteStudentSchema }), async (req: Request<S>, res) => {
  const result = await studentService.remove(await orgActor(req), req.params.studentId, req.body);
  sendSuccess(res, result, result.deleted ? 'Draft registration deleted' : 'Student archived');
});
studentRouter.post('/:studentId/restore', can('students.delete'), validate({ params: v.studentIdParams }), async (req: Request<S>, res) => {
  sendSuccess(res, await studentService.restore(await orgActor(req), req.params.studentId), 'Student restored');
});

// ----- Admission number -----
studentRouter.get('/:studentId/admission-number', can('students.read'), validate({ params: v.studentIdParams }), inScope('students.read'), async (req: Request<S>, res) => {
  sendSuccess(res, await admissionService.get(orgId(req), req.params.studentId));
});
studentRouter.patch('/:studentId/admission-number', can('students.configure'), validate({ params: v.studentIdParams, body: v.correctAdmissionSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await admissionService.correct(await orgActor(req), req.params.studentId, req.body), 'Admission number corrected');
});

// ----- Guardians -----
studentRouter.get('/:studentId/guardians', can('guardians.read'), validate({ params: v.studentIdParams }), inScope('guardians.read'), async (req: Request<S>, res) => {
  sendSuccess(res, await guardianService.list(orgId(req), req.params.studentId));
});
studentRouter.post('/:studentId/guardians', can('guardians.manage'), validate({ params: v.studentIdParams, body: v.createGuardianSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await guardianService.create(await orgActor(req), req.params.studentId, req.body), 'Contact added', 201);
});
studentRouter.patch('/:studentId/guardians/:guardianId', can('guardians.manage'), validate({ params: v.guardianParams, body: v.updateGuardianSchema }), async (req: Request<G>, res) => {
  sendSuccess(res, await guardianService.update(await orgActor(req), req.params.studentId, req.params.guardianId, req.body), 'Contact updated');
});
studentRouter.delete('/:studentId/guardians/:guardianId', can('guardians.manage'), validate({ params: v.guardianParams }), async (req: Request<G>, res) => {
  await guardianService.remove(await orgActor(req), req.params.studentId, req.params.guardianId);
  sendSuccess(res, null, 'Contact removed');
});
studentRouter.post('/:studentId/guardians/:guardianId/send-otp', otpSendLimit, can('guardians.manage'), validate({ params: v.guardianParams }), async (req: Request<G>, res) => {
  sendSuccess(res, await guardianService.sendOtp(await orgActor(req), req.params.studentId, req.params.guardianId), 'Code sent');
});
studentRouter.post('/:studentId/guardians/:guardianId/verify-otp', can('guardians.manage'), validate({ params: v.guardianParams, body: v.verifyOtpSchema }), async (req: Request<G>, res) => {
  sendSuccess(res, await guardianService.verifyOtp(await orgActor(req), req.params.studentId, req.params.guardianId, req.body.otp), 'Mobile number verified');
});

// ----- Class placements -----
studentRouter.get('/:studentId/assignments', can('students.read'), validate({ params: v.studentIdParams }), inScope('students.read'), async (req: Request<S>, res) => {
  sendSuccess(res, await assignmentService.history(orgId(req), req.params.studentId));
});
studentRouter.post('/:studentId/assignments', can('student_assignments.manage'), validate({ params: v.studentIdParams, body: v.createAssignmentSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await assignmentService.place(await orgActor(req), req.params.studentId, req.body), 'Class assigned', 201);
});
studentRouter.patch('/:studentId/assignments/:assignmentId', can('student_assignments.manage'), validate({ params: v.assignmentParams, body: v.correctAssignmentSchema }), async (req: Request<A>, res) => {
  sendSuccess(res, await assignmentService.correct(await orgActor(req), req.params.studentId, req.params.assignmentId, req.body), 'Placement corrected');
});
studentRouter.post('/:studentId/assignments/:assignmentId/close', can('student_assignments.manage'), validate({ params: v.assignmentParams, body: v.closeAssignmentSchema }), async (req: Request<A>, res) => {
  sendSuccess(res, await assignmentService.close(await orgActor(req), req.params.studentId, req.params.assignmentId, req.body), 'Placement closed');
});
studentRouter.post('/:studentId/transfer', can('student_assignments.manage'), validate({ params: v.studentIdParams, body: v.transferSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await assignmentService.transfer(await orgActor(req), req.params.studentId, req.body), 'Student transferred', 201);
});

// ----- Photograph -----
studentRouter.post('/:studentId/photo', can('students.update'), validate({ params: v.studentIdParams, body: v.savePhotoSchema }), async (req: Request<S>, res) => {
  sendSuccess(res, await photoService.save(await orgActor(req), req.params.studentId, req.body.fileId), 'Photo saved');
});
studentRouter.delete('/:studentId/photo', can('students.update'), validate({ params: v.studentIdParams }), async (req: Request<S>, res) => {
  await photoService.remove(await orgActor(req), req.params.studentId);
  sendSuccess(res, null, 'Photo removed');
});

// ----- ID card -----
studentRouter.get('/:studentId/id-card', can('student_id_cards.generate'), validate({ params: v.studentIdParams, query: v.idCardQuery }), inScope('student_id_cards.generate'), async (req: Request<S>, res) => {
  sendSuccess(res, await idCardService.preview(orgId(req), req.params.studentId, (req.query as z.infer<typeof v.idCardQuery>).templateId));
});
studentRouter.post('/:studentId/id-card/generate', can('student_id_cards.generate'), validate({ params: v.studentIdParams, body: v.generateIdCardSchema }), inScope('student_id_cards.generate'), async (req: Request<S>, res) => {
  const { pdf, fileName } = await idCardService.generate(await orgActor(req), req.params.studentId, req.body);
  sendPdf(res, pdf, fileName);
});

// ---------- /uploads ----------
export const uploadRouter = Router();
uploadRouter.use(authenticate, organizationContext);
uploadRouter.post('/student-photo/auth', can('students.update'), validate({ body: v.photoAuthSchema }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await photoService.uploadAuth(await orgActor(req), req.body.studentId));
});

// ---------- /settings/admission-number ----------
export const studentSettingsRouter = Router();
studentSettingsRouter.use(authenticate, organizationContext);
studentSettingsRouter.get('/admission-number', can('students.read'), async (req, res) => {
  sendSuccess(res, await studentSettingsService.get(orgId(req)));
});
studentSettingsRouter.get('/admission-number/preview', can('students.read'), validate({ query: v.admissionPreviewQuery }), async (req, res) => {
  sendSuccess(res, { admissionNumber: await admissionService.preview(orgId(req), (req.query as z.infer<typeof v.admissionPreviewQuery>).academicYearId) });
});
studentSettingsRouter.patch('/admission-number', can('students.configure'), validate({ body: v.admissionSettingsSchema }), async (req, res) => {
  const { format, sequencePadding, ...rest } = req.body as z.infer<typeof v.admissionSettingsSchema>;
  sendSuccess(res, await studentSettingsService.update(await orgActor(req), { ...rest, admissionNumber: { format, sequencePadding } }), 'Settings saved');
});

// ---------- /id-card-templates ----------
type T = { templateId: string };
export const idCardTemplateRouter = Router();
idCardTemplateRouter.use(authenticate, organizationContext);
idCardTemplateRouter.get('/', can('student_id_cards.generate'), async (req, res) => {
  sendSuccess(res, await idCardService.listTemplates(orgId(req)));
});
idCardTemplateRouter.post('/', can('students.configure'), validate({ body: v.createTemplateSchema }), async (req, res) => {
  sendSuccess(res, await idCardService.createTemplate(await orgActor(req), req.body), 'Template created', 201);
});
idCardTemplateRouter.patch('/:templateId', can('students.configure'), validate({ params: v.templateParams, body: v.updateTemplateSchema }), async (req: Request<T>, res) => {
  sendSuccess(res, await idCardService.updateTemplate(await orgActor(req), req.params.templateId, req.body), 'Template updated');
});
idCardTemplateRouter.delete('/:templateId', can('students.configure'), validate({ params: v.templateParams }), async (req: Request<T>, res) => {
  await idCardService.deleteTemplate(await orgActor(req), req.params.templateId);
  sendSuccess(res, null, 'Template deleted');
});

// ---------- /academic-years/:yearId/students ----------
export const yearStudentsRouter = Router({ mergeParams: true });
yearStudentsRouter.use(authenticate, organizationContext);
yearStudentsRouter.get('/', can('students.read'), validate({ params: v.yearParams, query: v.yearStudentsQuery }), async (req: Request<{ yearId: string }>, res) => {
  const query = { ...(req.query as unknown as ListQuery), academicYearId: req.params.yearId };
  sendSuccess(res, await studentService.list(await grants(req), orgId(req), query));
});
