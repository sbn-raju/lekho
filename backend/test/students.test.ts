import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { addMember, app, bearer, createActiveSchool, superAdminToken, webLogin } from './helpers.js';
import { env } from '../src/config/env.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { PERMISSION_CATALOG } from '../src/modules/permissions/permission.catalog.js';
import { testSmsOutbox } from '../src/modules/notifications/sms.js';
import { imagekit } from '../src/modules/uploads/imagekit.client.js';
import { StudentModel } from '../src/modules/students/student.model.js';
import { GuardianModel, GuardianOtpModel } from '../src/modules/students/guardian.model.js';
import { AdmissionCounterModel, StudentAssignmentModel } from '../src/modules/students/assignment.model.js';

const v1 = '/api/v1';
type Body = Record<string, unknown>;

const get = (t: string, path: string) => request(app).get(`${v1}${path}`).set(bearer(t));
const post = (t: string, path: string, body: Body = {}) => request(app).post(`${v1}${path}`).set(bearer(t)).send(body);
const patch = (t: string, path: string, body: Body) => request(app).patch(`${v1}${path}`).set(bearer(t)).send(body);
const put = (t: string, path: string, body: Body) => request(app).put(`${v1}${path}`).set(bearer(t)).send(body);
const del = (t: string, path: string, body: Body = {}) => request(app).delete(`${v1}${path}`).set(bearer(t)).send(body);

async function ok<T = Body>(res: request.Test | Promise<request.Response>, status = 200): Promise<T> {
  const r = await res;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as T;
}

const ADDRESS = { line1: '12 MG Road', city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', country: 'India', postalCode: '500001' };

/** A school with an active year, Grade 10 (sections A and B) and Grade 9 (section A). */
async function school() {
  const superToken = await superAdminToken();
  const s = await createActiveSchool(superToken);
  const t = s.adminToken;
  const year = await ok<{ id: string; code: string }>(post(t, '/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31' }), 201);
  await ok(patch(t, `/academic-years/${year.id}/status`, { status: 'active' }));
  const g10 = await ok<{ id: string; unitId: string }>(post(t, '/classes', { name: 'Grade 10', code: 'G10', displayOrder: 10 }), 201);
  const g9 = await ok<{ id: string; unitId: string }>(post(t, '/classes', { name: 'Grade 9', code: 'G9', displayOrder: 9 }), 201);
  const s10a = await ok<{ id: string; unitId: string }>(post(t, '/sections', { academicYearId: year.id, classId: g10.id, name: 'A', capacity: 3 }), 201);
  const s10b = await ok<{ id: string; unitId: string }>(post(t, '/sections', { academicYearId: year.id, classId: g10.id, name: 'B' }), 201);
  const s9a = await ok<{ id: string; unitId: string }>(post(t, '/sections', { academicYearId: year.id, classId: g9.id, name: 'A' }), 201);
  return { ...s, superToken, t, year, g10, g9, s10a, s10b, s9a };
}
type School = Awaited<ReturnType<typeof school>>;

async function memberToken(email: string, organizationId: string) {
  const { accessToken } = await webLogin(email);
  await request(app).post(`${v1}/me/active-organization`).set(bearer(accessToken)).send({ organizationId }).expect(200);
  return accessToken;
}

async function withRole(s: School, email: string, permissions: unknown[]) {
  const { user } = await addMember(s.t, email);
  const role = await ok<{ id: string }>(post(s.t, '/roles', { name: `Role ${Math.random().toString(36).slice(2, 7)}`, permissions }), 201);
  await ok(post(s.t, `/users/${user.id}/roles`, { roleId: role.id }));
  return { userId: user.id, token: await memberToken(email, s.organizationId) };
}

const draft = (t: string, body: Body = {}) =>
  ok<{ id: string; registration: { complete: boolean; missing: { field: string }[] } }>(
    post(t, '/students', { firstName: 'Asha', lastName: 'Rao', dateOfBirth: '2012-04-15', gender: 'female', residentialAddress: ADDRESS, ...body }),
    201,
  );

/** Reads the newest OTP sent to a number from the test SMS outbox. */
function otpFor(to: string): string {
  const msg = [...testSmsOutbox].reverse().find((m) => m.to === to);
  const code = msg?.text.match(/^(\d{6})/)?.[1];
  if (!code) throw new Error(`No OTP SMS to ${to}`);
  return code;
}

async function verifiedGuardian(t: string, studentId: string, mobile = '98765 43210', body: Body = {}) {
  const g = await ok<{ id: string; mobileNumber: string }>(post(t, `/students/${studentId}/guardians`, { fullName: 'Ravi Rao', relationship: 'father', mobileNumber: mobile, ...body }), 201);
  await ok(post(t, `/students/${studentId}/guardians/${g.id}/send-otp`));
  await ok(post(t, `/students/${studentId}/guardians/${g.id}/verify-otp`, { otp: otpFor(g.mobileNumber) }));
  return g;
}

/** Fully registered student, optionally placed in a section. */
async function registered(s: School, opts: { sectionId?: string; classId?: string; firstName?: string; mobile?: string } = {}) {
  const st = await draft(s.t, { firstName: opts.firstName ?? 'Asha' });
  await verifiedGuardian(s.t, st.id, opts.mobile ?? `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`);
  const assignment = opts.sectionId ? { academicYearId: s.year.id, classId: opts.classId ?? s.g10.id, sectionId: opts.sectionId } : undefined;
  return ok<{ id: string; admissionNumber: string; status: string; currentAssignment: Body | null }>(post(s.t, `/students/${st.id}/complete-registration`, { assignment }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('permission catalog', () => {
  it('registers student permissions, with read permissions scoped by student', () => {
    const students = PERMISSION_CATALOG.filter((p) => p.module === 'students');
    expect(students.map((p) => p.code)).toEqual(
      expect.arrayContaining(['students.read', 'students.read_sensitive', 'students.create', 'students.update', 'students.delete', 'guardians.read', 'guardians.manage', 'student_assignments.manage', 'student_id_cards.generate', 'students.configure']),
    );
    for (const code of ['students.read', 'students.read_sensitive', 'guardians.read', 'student_id_cards.generate']) {
      expect(students.find((p) => p.code === code)?.scopedResource).toBe('student');
    }
  });
});

describe('registration', () => {
  it('saves a draft, reports what is missing, and computes age', async () => {
    const s = await school();
    const d = await ok<Body & { registration: { complete: boolean; missing: { field: string }[] } }>(post(s.t, '/students', { firstName: 'Kiran' }), 201);
    expect(d).toMatchObject({ status: 'draft', registrationStatus: 'draft', admissionNumber: null, fullName: 'Kiran' });
    expect(d.registration.complete).toBe(false);
    expect(d.registration.missing.map((m) => m.field)).toEqual(expect.arrayContaining(['lastName', 'dateOfBirth', 'gender', 'residentialAddress', 'guardians']));

    const full = await draft(s.t);
    const view = await ok<Body>(get(s.t, `/students/${full.id}`));
    expect(view.age).toBeGreaterThanOrEqual(14);
    expect(full.registration.missing.map((m) => m.field)).toEqual(['guardians']);
  });

  it('validates input', async () => {
    const s = await school();
    expect((await post(s.t, '/students', {})).status).toBe(400);
    expect((await post(s.t, '/students', { firstName: 'A', dateOfBirth: '2099-01-01' })).status).toBe(400);
    expect((await post(s.t, '/students', { firstName: 'A', gender: 'robot' })).status).toBe(400);
    expect((await post(s.t, '/students', { firstName: 'A', casteCategory: 'Made up' })).status).toBe(400);
    await ok(post(s.t, '/students', { firstName: 'A', casteCategory: 'obc' }), 201);
  });

  it('cannot complete without a verified parent or guardian, then issues an admission number', async () => {
    const s = await school();
    const st = await draft(s.t);
    const g = await ok<{ id: string; mobileNumber: string; isPrimaryContact: boolean; verificationStatus: string }>(
      post(s.t, `/students/${st.id}/guardians`, { fullName: 'Lakshmi Rao', relationship: 'mother', mobileNumber: '098765 43210' }),
      201,
    );
    // Local number normalised to E.164; first contact becomes primary.
    expect(g).toMatchObject({ mobileNumber: '+919876543210', isPrimaryContact: true, verificationStatus: 'unverified' });

    const blocked = await post(s.t, `/students/${st.id}/complete-registration`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('REGISTRATION_INCOMPLETE');

    await ok(post(s.t, `/students/${st.id}/guardians/${g.id}/send-otp`));
    const verified = await ok<Body>(post(s.t, `/students/${st.id}/guardians/${g.id}/verify-otp`, { otp: otpFor('+919876543210') }));
    expect(verified.verificationStatus).toBe('verified');

    const done = await ok<Body>(post(s.t, `/students/${st.id}/complete-registration`, { assignment: { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id } }));
    expect(done).toMatchObject({ status: 'active', registrationStatus: 'completed', hasVerifiedContact: true });
    // Default format {SCHOOL_CODE}-{YEAR}-{SEQ}.
    expect(done.admissionNumber).toMatch(/^SCH\d+-2026-0001$/);
    expect(done.currentAssignment).toMatchObject({ class: { name: 'Grade 10' }, section: { name: 'A' }, assignmentType: 'admission', status: 'active' });
    expect((await post(s.t, `/students/${st.id}/complete-registration`)).status).toBe(409);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['student.registered', 'student.admission_number_generated', 'guardian.mobile_verified', 'student_assignment.created'] } })).toBe(4);
  });

  it("only a father's, mother's or guardian's verified number counts", async () => {
    const s = await school();
    const st = await draft(s.t);
    await verifiedGuardian(s.t, st.id, '9876500001', { fullName: 'Neighbour', relationship: 'other', relationshipLabel: 'Neighbour' });
    expect((await post(s.t, `/students/${st.id}/complete-registration`)).status).toBe(422);
  });
});

describe('guardian OTP', () => {
  async function pending(s: School) {
    const st = await draft(s.t);
    const g = await ok<{ id: string; mobileNumber: string }>(post(s.t, `/students/${st.id}/guardians`, { fullName: 'Ravi', relationship: 'father', mobileNumber: '+91 91234 56789' }), 201);
    return { st, g, path: `/students/${st.id}/guardians/${g.id}` };
  }

  it('stores only a hash, never logs the code, and is single use', async () => {
    const s = await school();
    const { g, path } = await pending(s);
    const sent = await ok<Body>(post(s.t, `${path}/send-otp`));
    expect(sent).toMatchObject({ sentTo: '+91 ••••••6789', attemptsAllowed: 5 });
    const code = otpFor(g.mobileNumber);
    const doc = await GuardianOtpModel.findOne({ guardianId: g.id }).lean();
    expect(doc!.otpHash).not.toContain(code);
    expect(doc!.otpHash).toMatch(/^[0-9a-f]{64}$/);
    const logs = await AuditLogModel.find({}).lean();
    expect(JSON.stringify(logs)).not.toContain(code);

    await ok(post(s.t, `${path}/verify-otp`, { otp: code }));
    // Already verified; and the challenge is consumed.
    expect((await post(s.t, `${path}/verify-otp`, { otp: code })).status).toBe(409);
    expect((await GuardianOtpModel.findById(doc!._id).lean())!.verifiedAt).toBeTruthy();
  });

  it('limits attempts, expires codes, and enforces the resend cooldown', async () => {
    const s = await school();
    const { g, path } = await pending(s);
    await ok(post(s.t, `${path}/send-otp`));
    const code = otpFor(g.mobileNumber);
    const wrong = code === '000000' ? '111111' : '000000';

    const cooldown = await post(s.t, `${path}/send-otp`);
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.details.reason).toBe('otp_cooldown');

    for (let i = 0; i < 4; i++) {
      const r = await post(s.t, `${path}/verify-otp`, { otp: wrong });
      expect(r.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsRemaining: 4 - i } });
    }
    expect((await post(s.t, `${path}/verify-otp`, { otp: wrong })).body.error.code).toBe('OTP_INVALID');
    // Locked even for the right code.
    expect((await post(s.t, `${path}/verify-otp`, { otp: code })).body.error.code).toBe('OTP_LOCKED');

    // A new code (after the cooldown) works; an expired one doesn't.
    await GuardianOtpModel.collection.updateMany({ guardianId: new Types.ObjectId(g.id) }, { $set: { createdAt: new Date(Date.now() - 120_000) } });
    await ok(post(s.t, `${path}/send-otp`));
    await GuardianOtpModel.updateMany({ guardianId: g.id, supersededAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post(s.t, `${path}/verify-otp`, { otp: otpFor(g.mobileNumber) })).body.error.code).toBe('OTP_EXPIRED');
  });

  it('caps codes per number per day', async () => {
    const s = await school();
    const { st, g, path } = await pending(s);
    const old = new Date(Date.now() - 3_600_000);
    await GuardianOtpModel.insertMany(
      Array.from({ length: env.OTP_MAX_REQUESTS_PER_DAY }, () => ({ organizationId: s.organizationId, studentId: st.id, guardianId: g.id, mobileNumber: g.mobileNumber, otpHash: 'x', expiresAt: old, requestedBy: st.id, purgeAt: new Date(Date.now() + 3_600_000), createdAt: old })),
    );
    const r = await post(s.t, `${path}/send-otp`);
    expect(r.status).toBe(429);
    expect(r.body.error.details.reason).toBe('otp_daily_limit');
  });

  it('invalidates verification, and pending codes, when the number changes', async () => {
    const s = await school();
    const st = await draft(s.t);
    const g = await verifiedGuardian(s.t, st.id, '9000000001');
    await ok(post(s.t, `/students/${st.id}/complete-registration`));

    const changed = await ok<Body>(patch(s.t, `/students/${st.id}/guardians/${g.id}`, { mobileNumber: '9000000002' }));
    expect(changed).toMatchObject({ mobileNumber: '+919000000002', verificationStatus: 'unverified', verifiedAt: null });
    expect((await ok<Body>(get(s.t, `/students/${st.id}`))).hasVerifiedContact).toBe(false);
    expect(await AuditLogModel.countDocuments({ action: 'guardian.mobile_changed' })).toBe(1);

    // Changing back doesn't resurrect the old verification either.
    const back = await ok<Body>(patch(s.t, `/students/${st.id}/guardians/${g.id}`, { mobileNumber: '9000000001' }));
    expect(back.verificationStatus).toBe('unverified');
  });

  it('a code sent before a number change cannot verify the new number', async () => {
    const s = await school();
    const { g, path } = await pending(s);
    await ok(post(s.t, `${path}/send-otp`));
    const code = otpFor(g.mobileNumber);
    await ok(patch(s.t, path, { mobileNumber: '9123400000' }));
    expect((await post(s.t, `${path}/verify-otp`, { otp: code })).body.error.code).toBe('OTP_INVALID');
  });

  it('keeps one primary contact and protects the last verified contact of a registered student', async () => {
    const s = await school();
    const st = await registered(s);
    const [father] = await ok<{ id: string }[]>(get(s.t, `/students/${st.id}/guardians`));
    const mother = await ok<{ id: string }>(post(s.t, `/students/${st.id}/guardians`, { fullName: 'Mother', relationship: 'mother', mobileNumber: '9333300000', isPrimaryContact: true }), 201);
    const list = await ok<{ id: string; isPrimaryContact: boolean }[]>(get(s.t, `/students/${st.id}/guardians`));
    expect(list.filter((g) => g.isPrimaryContact).map((g) => g.id)).toEqual([mother.id]);
    expect((await patch(s.t, `/students/${st.id}/guardians/${mother.id}`, { isPrimaryContact: false })).status).toBe(400);

    const refused = await del(s.t, `/students/${st.id}/guardians/${father!.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('last_verified_contact');
    await ok(del(s.t, `/students/${st.id}/guardians/${mother.id}`));
    // The remaining contact becomes primary again.
    expect((await ok<{ isPrimaryContact: boolean }[]>(get(s.t, `/students/${st.id}/guardians`)))[0]!.isPrimaryContact).toBe(true);
  });
});

describe('admission numbers', () => {
  it('are unique and gap-free under concurrent registrations', async () => {
    const s = await school();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const st = await draft(s.t, { firstName: `Student${i}` });
      // Seed verified contacts directly to keep the test fast.
      await GuardianModel.create({ organizationId: s.organizationId, studentId: st.id, fullName: 'P', relationship: 'father', mobileNumber: `+9190000000${i}0`, isPrimaryContact: true, verification: { mobileNumber: `+9190000000${i}0`, verifiedAt: new Date() }, createdBy: st.id });
      ids.push(st.id);
    }
    const results = await Promise.all(ids.map((id) => post(s.t, `/students/${id}/complete-registration`)));
    const numbers = results.map((r) => r.body.data?.admissionNumber as string);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.map((n) => Number(n.slice(-4))).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('follows the configured format and is never reused after archiving', async () => {
    const s = await school();
    expect((await patch(s.t, '/settings/admission-number', { format: 'ADM-{SEQ}-{SEQ}' })).status).toBe(400);
    expect((await patch(s.t, '/settings/admission-number', { format: 'ADM-{NOPE}-{SEQ}' })).status).toBe(400);
    expect((await patch(s.t, '/settings/admission-number', { format: 'ADM {SEQ}' })).status).toBe(400);
    const saved = await ok<Body>(patch(s.t, '/settings/admission-number', { format: 'ADM/{YY}/{SEQ}', sequencePadding: 6 }));
    expect(saved.admissionNumberPreview).toBe('ADM/26/000001');

    const a = await registered(s);
    expect(a.admissionNumber).toBe('ADM/26/000001');
    await ok(del(s.t, `/students/${a.id}`, { reason: 'Duplicate entry' }));
    const b = await registered(s);
    expect(b.admissionNumber).toBe('ADM/26/000002');
    expect((await AdmissionCounterModel.findOne({ organizationId: s.organizationId }).lean())!.currentSequence).toBe(2);
  });

  it('supports an audited correction, refusing numbers in use or retired', async () => {
    const s = await school();
    const a = await registered(s);
    const b = await registered(s);
    expect((await patch(s.t, `/students/${a.id}/admission-number`, { admissionNumber: b.admissionNumber, reason: 'x' })).status).toBe(409);
    const fixed = await ok<{ admissionNumber: string; history: Body[] }>(patch(s.t, `/students/${a.id}/admission-number`, { admissionNumber: 'OLD-0042', reason: 'Matches the paper register' }));
    expect(fixed.admissionNumber).toBe('OLD-0042');
    expect(fixed.history).toHaveLength(1);
    expect((await patch(s.t, `/students/${b.id}/admission-number`, { admissionNumber: a.admissionNumber, reason: 'reuse' })).status).toBe(409);
    expect(await AuditLogModel.countDocuments({ action: 'student.admission_number_corrected' })).toBe(1);
  });
});

describe('class placements', () => {
  it('allows one active placement per year, transfers preserve history', async () => {
    const s = await school();
    const st = await registered(s, { sectionId: s.s10a.id });
    const dup = await post(s.t, `/students/${st.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10b.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.reason).toBe('already_assigned');

    const moved = await ok<Body>(post(s.t, `/students/${st.id}/transfer`, { sectionId: s.s9a.id, reason: 'Wrong grade' }), 201);
    expect(moved).toMatchObject({ class: { name: 'Grade 9' }, section: { name: 'A' }, assignmentType: 'transfer', status: 'active' });
    const history = await ok<{ status: string }[]>(get(s.t, `/students/${st.id}/assignments`));
    expect(history.map((h) => h.status).sort()).toEqual(['active', 'superseded']);
    expect(await StudentAssignmentModel.countDocuments({ studentId: st.id, status: 'active' })).toBe(1);
  });

  it('validates the year / class / section relationship and section strength', async () => {
    const s = await school();
    const st = await registered(s);
    const mismatch = await post(s.t, `/students/${st.id}/assignments`, { academicYearId: s.year.id, classId: s.g9.id, sectionId: s.s10a.id });
    expect(mismatch.status).toBe(400);
    expect((await post(s.t, `/students/${st.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: '0123456789abcdef01234567' })).status).toBe(404);

    for (let i = 0; i < 2; i++) await registered(s, { sectionId: s.s10a.id });
    await ok(post(s.t, `/students/${st.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id }), 201);
    const full = await registered(s);
    const r = await post(s.t, `/students/${full.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id });
    expect(r.body.error.details.reason).toBe('section_full');
    await ok(post(s.t, `/students/${full.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id, allowOverCapacity: true }), 201);
  });

  it('refuses drafts, and locks closed years except for audited corrections', async () => {
    const s = await school();
    const d = await draft(s.t);
    expect((await post(s.t, `/students/${d.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id })).body.error.details.reason).toBe('registration_incomplete');

    const st = await registered(s, { sectionId: s.s10a.id });
    const [a] = await ok<{ id: string }[]>(get(s.t, `/students/${st.id}/assignments`));
    await ok(patch(s.t, `/academic-years/${s.year.id}/status`, { status: 'completed' }));
    expect((await post(s.t, `/students/${st.id}/transfer`, { sectionId: s.s10b.id })).body.error.details.reason).toBe('year_locked');
    expect((await patch(s.t, `/students/${st.id}/assignments/${a!.id}`, { sectionId: s.s10b.id })).status).toBe(400); // reason required
    const corrected = await ok<{ section: { name: string }; corrections: Body[] }>(patch(s.t, `/students/${st.id}/assignments/${a!.id}`, { sectionId: s.s10b.id, reason: 'Entered in the wrong section' }));
    expect(corrected.section.name).toBe('B');
    expect(corrected.corrections).toHaveLength(1);
  });

  it('promotes a section into the next year and closes the previous placement', async () => {
    const s = await school();
    const a = await registered(s, { sectionId: s.s9a.id, classId: s.g9.id });
    const b = await registered(s, { sectionId: s.s9a.id, classId: s.g9.id });
    const next = await ok<{ id: string }>(post(s.t, '/academic-years', { name: '2027-28', startDate: '2027-06-01', endDate: '2028-03-31' }), 201);
    const n10a = await ok<{ id: string }>(post(s.t, '/sections', { academicYearId: next.id, classId: s.g10.id, name: 'A' }), 201);
    const result = await ok<{ placed: number; skipped: Body[] }>(post(s.t, '/students/bulk-promote', { fromSectionId: s.s9a.id, toSectionId: n10a.id }));
    expect(result).toMatchObject({ placed: 2, skipped: [] });
    for (const id of [a.id, b.id]) {
      const h = await ok<{ status: string; outcome: string | null; academicYear: { name: string } }[]>(get(s.t, `/students/${id}/assignments`));
      expect(h.map((x) => [x.academicYear.name, x.status, x.outcome])).toEqual([
        ['2027-28', 'active', null],
        ['2026-27', 'completed', 'promoted'],
      ]);
    }
    // Running it again skips everyone already placed.
    expect((await ok<{ placed: number; skipped: { reason: string }[] }>(post(s.t, '/students/bulk-promote', { fromSectionId: s.s9a.id, toSectionId: n10a.id }))).skipped.map((k) => k.reason)).toEqual(['already_assigned', 'already_assigned']);
  });
});

describe('listing and search', () => {
  it('searches by name, admission number and parent mobile, and filters by class and verification', async () => {
    const s = await school();
    const a = await registered(s, { firstName: 'Meera', sectionId: s.s10a.id, mobile: '9811122233' });
    await registered(s, { firstName: 'Arjun', sectionId: s.s10b.id });
    await draft(s.t, { firstName: 'Zoya' });

    const names = async (q: string) => (await ok<{ items: { firstName: string }[] }>(get(s.t, `/students?${q}`))).items.map((i) => i.firstName);
    expect(await names('')).toEqual(['Arjun', 'Meera', 'Zoya']);
    expect(await names('search=meera')).toEqual(['Meera']);
    expect(await names(`search=${encodeURIComponent(a.admissionNumber)}`)).toEqual(['Meera']);
    expect(await names('search=9811122233')).toEqual(['Meera']);
    expect(await names(`sectionId=${s.s10b.id}`)).toEqual(['Arjun']);
    expect(await names(`classId=${s.g10.id}`)).toEqual(['Arjun', 'Meera']);
    expect(await names('verification=unverified')).toEqual(['Zoya']);
    expect(await names('status=draft')).toEqual(['Zoya']);

    const page = await ok<{ items: Body[]; total: number }>(get(s.t, `/academic-years/${s.year.id}/students`));
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ currentAssignment: { class: { name: 'Grade 10' } }, primaryContact: { relationship: 'father', verified: true } });
    expect(page.items[0]).not.toHaveProperty('sensitive');
  });
});

describe('teachers', () => {
  async function setup() {
    const s = await school();
    const mine = await registered(s, { firstName: 'Mine', sectionId: s.s10a.id });
    const other = await registered(s, { firstName: 'Other', sectionId: s.s10b.id });
    await ok(patch(s.t, `/students/${mine.id}`, { religion: 'Hindu', medicalNotes: 'Asthma' }));
    // A teacher role: read students and guardians of the sections they are placed in.
    const teacher = await withRole(s, 'teacher@school.test', [
      { permission: 'students.read', scopes: [{ type: 'assigned' }] },
      { permission: 'guardians.read', scopes: [{ type: 'assigned' }] },
    ]);
    await ok(put(s.t, `/sections/${s.s10a.id}/class-teacher`, { userId: teacher.userId }));
    return { s, mine, other, teacher };
  }

  it('see only students in their sections, whatever the query parameters', async () => {
    const { s, mine, other, teacher } = await setup();
    const t = teacher.token;
    const list = await ok<{ items: { id: string }[]; total: number }>(get(t, '/students'));
    expect(list.items.map((i) => i.id)).toEqual([mine.id]);
    expect((await ok<{ total: number }>(get(t, `/students?sectionId=${s.s10b.id}`))).total).toBe(0);
    expect((await ok<{ total: number }>(get(t, `/students?search=Other`))).total).toBe(0);
    expect((await get(t, `/students/${other.id}`)).status).toBe(403);
    expect((await get(t, `/students/${other.id}/guardians`)).status).toBe(403);
    expect((await get(t, `/students/${other.id}/assignments`)).status).toBe(403);

    const view = await ok<Body>(get(t, `/students/${mine.id}`));
    expect(view).toMatchObject({ id: mine.id, admissionNumber: mine.admissionNumber, permissions: { sensitive: false, guardians: true } });
    expect(view).not.toHaveProperty('sensitive');
    expect((await ok<Body[]>(get(t, `/students/${mine.id}/guardians`))).length).toBe(1);

    const my = await ok<{ sections: { id: string; studentCount: number }[] }>(get(t, '/students/my-sections'));
    expect(my.sections).toEqual([expect.objectContaining({ id: s.s10a.id, studentCount: 1 })]);
  });

  it('cannot create, update, delete, assign, verify or generate ID cards', async () => {
    const { s, mine, teacher } = await setup();
    const t = teacher.token;
    const [g] = await ok<{ id: string }[]>(get(s.t, `/students/${mine.id}/guardians`));
    const attempts = [
      post(t, '/students', { firstName: 'X' }),
      patch(t, `/students/${mine.id}`, { firstName: 'Y' }),
      del(t, `/students/${mine.id}`),
      patch(t, `/students/${mine.id}/status`, { status: 'inactive' }),
      post(t, `/students/${mine.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10b.id }),
      post(t, `/students/${mine.id}/transfer`, { sectionId: s.s10b.id }),
      post(t, `/students/${mine.id}/guardians/${g!.id}/send-otp`),
      post(t, `/students/${mine.id}/id-card/generate`),
      post(t, '/students/id-cards/bulk-generate', { sectionId: s.s10a.id }),
      post(t, '/uploads/student-photo/auth', { studentId: mine.id }),
      patch(t, '/settings/admission-number', { format: 'X-{SEQ}' }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.status).toBe(403);
  });

  it('lose access when the student leaves their section', async () => {
    const { s, mine, teacher } = await setup();
    await ok(post(s.t, `/students/${mine.id}/transfer`, { sectionId: s.s10b.id }), 201);
    expect((await get(teacher.token, `/students/${mine.id}`)).status).toBe(403);
  });
});

describe('sensitive data', () => {
  it('is shown only with students.read_sensitive, and each view is audited', async () => {
    const s = await school();
    const st = await registered(s, { sectionId: s.s10a.id });
    await ok(patch(s.t, `/students/${st.id}`, { religion: 'Hindu', casteCategory: 'OBC', medicalNotes: 'Peanut allergy' }));
    const updated = await AuditLogModel.findOne({ action: 'student.updated' }).lean();
    expect(JSON.stringify(updated)).not.toContain('Peanut');
    expect(updated!.metadata).toMatchObject({ changedFields: expect.arrayContaining(['religion', 'medicalNotes']), sensitiveChanged: true });

    const admin = await ok<Body>(get(s.t, `/students/${st.id}`));
    expect(admin.sensitive).toMatchObject({ religion: 'Hindu', casteCategory: 'OBC', medicalNotes: 'Peanut allergy' });
    expect(await AuditLogModel.countDocuments({ action: 'student.sensitive_viewed' })).toBe(1);

    const reader = await withRole(s, 'office@school.test', ['students.read']);
    expect(await ok<Body>(get(reader.token, `/students/${st.id}`))).not.toHaveProperty('sensitive');
    // Without guardians.read, contact details are withheld.
    expect((await ok<{ items: Body[] }>(get(reader.token, '/students'))).items[0]!.primaryContact).toBeNull();
    expect((await get(reader.token, `/students/${st.id}/guardians`)).status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('hides other schools’ students entirely', async () => {
    const s = await school();
    const st = await registered(s, { sectionId: s.s10a.id });
    const other = await createActiveSchool(s.superToken);
    const t2 = other.adminToken;
    expect((await get(t2, `/students/${st.id}`)).status).toBe(404);
    expect((await patch(t2, `/students/${st.id}`, { firstName: 'Hacked' })).status).toBe(404);
    expect((await get(t2, `/students/${st.id}/guardians`)).status).toBe(404);
    expect((await post(t2, `/students/${st.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id })).status).toBe(404);
    expect((await ok<{ total: number }>(get(t2, '/students'))).total).toBe(0);
    // Another school's year/class/section can't be used for a placement either.
    const mine = await registered({ ...s, t: t2 } as School);
    expect((await post(t2, `/students/${mine.id}/assignments`, { academicYearId: s.year.id, classId: s.g10.id, sectionId: s.s10a.id })).status).toBe(404);
  });
});

describe('lifecycle', () => {
  it('deletes drafts, archives registered students, and restores them', async () => {
    const s = await school();
    const d = await draft(s.t);
    await ok(post(s.t, `/students/${d.id}/guardians`, { fullName: 'P', relationship: 'father', mobileNumber: '9000011111' }), 201);
    expect(await ok(del(s.t, `/students/${d.id}`))).toMatchObject({ deleted: true });
    expect(await StudentModel.countDocuments({ _id: d.id })).toBe(0);
    expect(await GuardianModel.countDocuments({ studentId: d.id })).toBe(0);

    const st = await registered(s);
    expect(await ok(del(s.t, `/students/${st.id}`))).toMatchObject({ archived: true });
    expect((await ok<{ total: number }>(get(s.t, '/students'))).total).toBe(0);
    expect((await ok<{ total: number }>(get(s.t, '/students?archived=true'))).total).toBe(1);
    expect((await patch(s.t, `/students/${st.id}`, { firstName: 'X' })).status).toBe(409);
    await ok(post(s.t, `/students/${st.id}/restore`));
    expect((await ok<{ total: number }>(get(s.t, '/students'))).total).toBe(1);
  });

  it('closes the placement when a student leaves, and lists only active students in class lists', async () => {
    const s = await school();
    const st = await registered(s, { sectionId: s.s10a.id });
    expect((await patch(s.t, `/students/${st.id}/status`, { status: 'withdrawn' })).status).toBe(400); // reason required
    await ok(patch(s.t, `/students/${st.id}/status`, { status: 'withdrawn', reason: 'Family moved' }));
    const [a] = await ok<{ status: string; outcome: string }[]>(get(s.t, `/students/${st.id}/assignments`));
    expect(a).toMatchObject({ status: 'completed', outcome: 'withdrawn' });
    expect((await ok<{ total: number }>(get(s.t, `/students?sectionId=${s.s10a.id}`))).total).toBe(0);
    expect((await patch(s.t, `/students/${st.id}/status`, { status: 'graduated', reason: 'x' })).status).toBe(409);
    await ok(patch(s.t, `/students/${st.id}/status`, { status: 'active', reason: 'Re-admitted' }));

    const history = await ok<{ items: { action: string }[] }>(get(s.t, `/students/${st.id}/history`));
    expect(history.items.map((h) => h.action)).toEqual(expect.arrayContaining(['student.created', 'guardian.added', 'guardian.otp_sent', 'guardian.mobile_verified', 'student.registered', 'student_assignment.closed', 'student.status_changed']));
  });
});

describe('photos (ImageKit)', () => {
  function configure() {
    Object.assign(env, { IMAGEKIT_PUBLIC_KEY: 'public_test', IMAGEKIT_PRIVATE_KEY: 'private_test', IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/lekho' });
  }
  afterEach(() => {
    Object.assign(env, { IMAGEKIT_PUBLIC_KEY: undefined, IMAGEKIT_PRIVATE_KEY: undefined, IMAGEKIT_URL_ENDPOINT: undefined });
  });

  it('is unavailable until ImageKit is configured', async () => {
    const s = await school();
    const st = await draft(s.t);
    expect((await post(s.t, '/uploads/student-photo/auth', { studentId: st.id })).status).toBe(503);
  });

  it('issues upload auth without exposing the private key, verifies uploads, and serves signed URLs', async () => {
    configure();
    const s = await school();
    const st = await draft(s.t);
    const auth = await ok<Record<string, unknown>>(post(s.t, '/uploads/student-photo/auth', { studentId: st.id }));
    expect(auth).toMatchObject({ publicKey: 'public_test', isPrivateFile: true, folder: `/lekho/${s.organizationId}/students/${st.id}` });
    expect(auth.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(auth)).not.toContain('private_test');

    const folder = auth.folder as string;
    const file = { fileId: 'f1', name: 'photo.jpg', filePath: `${folder}/photo.jpg`, mime: 'image/jpeg', size: 200_000, width: 600, height: 800, isPrivateFile: true };
    const deleted: string[] = [];
    vi.spyOn(imagekit, 'deleteFile').mockImplementation(async (id) => void deleted.push(id));
    vi.spyOn(imagekit, 'getFile').mockImplementation(async (id) =>
      ({
        f1: file,
        f2: { ...file, fileId: 'f2', filePath: `${folder}/p2.jpg` },
        pub: { ...file, fileId: 'pub', isPrivateFile: false },
        big: { ...file, fileId: 'big', size: 6 * 1024 * 1024 },
        foreign: { ...file, fileId: 'foreign', filePath: '/lekho/someone-else/students/x/p.jpg' },
      })[id] ?? null,
    );

    expect((await post(s.t, `/students/${st.id}/photo`, { fileId: 'pub' })).status).toBe(400);
    expect((await post(s.t, `/students/${st.id}/photo`, { fileId: 'big' })).status).toBe(400);
    expect((await post(s.t, `/students/${st.id}/photo`, { fileId: 'foreign' })).status).toBe(400);
    expect((await post(s.t, `/students/${st.id}/photo`, { fileId: 'missing' })).status).toBe(400);
    // Rejected uploads into the student's folder are deleted; a foreign file is left alone.
    expect(deleted).toEqual(['pub', 'big']);

    const saved = await ok<{ url: string; thumbnailUrl: string; version: number }>(post(s.t, `/students/${st.id}/photo`, { fileId: 'f1' }));
    expect(saved.version).toBe(1);
    expect(saved.url).toMatch(/^https:\/\/ik\.imagekit\.io\/lekho\/tr:w-600,h-800,c-at_max\/lekho\/.+\/photo\.jpg\?ik-t=\d+&ik-s=[0-9a-f]{40}$/);

    // Replacing deletes the old file (default retention policy).
    const replaced = await ok<{ version: number }>(post(s.t, `/students/${st.id}/photo`, { fileId: 'f2' }));
    expect(replaced.version).toBe(2);
    expect(deleted).toContain('f1');
    await ok(del(s.t, `/students/${st.id}/photo`));
    expect(deleted).toContain('f2');
    expect(await AuditLogModel.countDocuments({ action: { $in: ['student.photo_uploaded', 'student.photo_replaced', 'student.photo_removed'] } })).toBe(3);
  });
});

describe('ID cards', () => {
  const withPhoto = (id: string) => StudentModel.updateOne({ _id: id }, { $set: { photo: { fileId: 'f', filePath: '/lekho/x/p.jpg', fileName: 'p.jpg', mimeType: 'image/jpeg', size: 1, uploadedAt: new Date(), uploadedBy: id, version: 1 } } });

  it('previews, generates a PDF, and records each card without sensitive data', async () => {
    const s = await school();
    const st = await registered(s, { sectionId: s.s10a.id });
    await ok(patch(s.t, `/students/${st.id}`, { religion: 'Hindu', bloodGroup: 'B+' }));

    const blocked = await ok<{ eligible: boolean; problems: { reason: string }[] }>(get(s.t, `/students/${st.id}/id-card`));
    expect(blocked).toMatchObject({ eligible: false, problems: [{ reason: 'no_photo' }] });
    expect((await post(s.t, `/students/${st.id}/id-card/generate`)).body.error.details.reason).toBe('no_photo');

    await withPhoto(st.id);
    const preview = await ok<{ eligible: boolean; card: Body }>(get(s.t, `/students/${st.id}/id-card`));
    expect(preview.eligible).toBe(true);
    expect(preview.card).toMatchObject({ admissionNumber: st.admissionNumber, className: 'Grade 10', sectionName: 'A', academicYear: '2026-27', bloodGroup: 'B+' });
    expect(JSON.stringify(preview)).not.toContain('Hindu');

    const pdf = await post(s.t, `/students/${st.id}/id-card/generate`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // A drawn card, not an empty page.
    expect((pdf.body as Buffer).length).toBeGreaterThan(2000);
    const profile = await ok<{ idCards: { version: number }[] }>(get(s.t, `/students/${st.id}/profile`));
    expect(profile.idCards.map((c) => c.version)).toEqual([1]);
    expect(await AuditLogModel.countDocuments({ action: 'id_card.generated' })).toBe(1);
  });

  it('bulk generates for a section, skipping ineligible and inactive students', async () => {
    const s = await school();
    const a = await registered(s, { firstName: 'Ana', sectionId: s.s10a.id });
    const b = await registered(s, { firstName: 'Ben', sectionId: s.s10a.id });
    const c = await registered(s, { firstName: 'Cal', sectionId: s.s10a.id });
    await withPhoto(a.id);
    await withPhoto(c.id);
    await ok(patch(s.t, `/students/${c.id}/status`, { status: 'inactive' }));

    const dry = await ok<{ eligible: number; skipped: { studentId: string; reason: string }[] }>(post(s.t, '/students/id-cards/bulk-generate', { sectionId: s.s10a.id, dryRun: true }));
    expect(dry.eligible).toBe(1);
    expect(dry.skipped).toEqual([expect.objectContaining({ studentId: b.id, reason: 'no_photo' })]);

    const res = await post(s.t, '/students/id-cards/bulk-generate', { sectionId: s.s10a.id, includeInactive: true }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (x: Buffer) => chunks.push(x));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['x-idcards-generated']).toBe('2');
    expect(res.headers['x-idcards-skipped']).toBe('1');
    expect(await AuditLogModel.countDocuments({ action: 'id_card.bulk_generated' })).toBe(1);
  });

  it('manages templates and keeps one default', async () => {
    const s = await school();
    const list = await ok<{ id: string; isDefault: boolean }[]>(get(s.t, '/id-card-templates'));
    expect(list).toEqual([expect.objectContaining({ id: 'standard', isDefault: true })]);
    const t1 = await ok<{ id: string }>(post(s.t, '/id-card-templates', { name: 'Blue', primaryColor: '#0033AA', isDefault: true, fields: ['admissionNumber', 'class'] }), 201);
    const t2 = await ok<{ id: string }>(post(s.t, '/id-card-templates', { name: 'Green', primaryColor: '#00AA33' }), 201);
    expect((await post(s.t, '/id-card-templates', { name: 'Bad', fields: ['religion'] })).status).toBe(400);
    await ok(patch(s.t, `/id-card-templates/${t2.id}`, { isDefault: true }));
    const after = await ok<{ id: string; isDefault: boolean }[]>(get(s.t, '/id-card-templates'));
    expect(after.filter((x) => x.isDefault).map((x) => x.id)).toEqual([t2.id]);
    expect((await patch(s.t, '/id-card-templates/standard', { name: 'x' })).status).toBe(400);
    await ok(del(s.t, `/id-card-templates/${t1.id}`));
  });
});
