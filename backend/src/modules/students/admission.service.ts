import type { ClientSession } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { AcademicYearModel } from '../academics/academic-year.model.js';
import { AdmissionCounterModel, DEFAULT_ADMISSION_FORMAT, DEFAULT_CASTE_CATEGORIES, StudentSettingsModel } from './assignment.model.js';
import { StudentModel } from './student.model.js';
import { audit, findStudent } from './students.shared.js';

/**
 * Admission number formats (FRD §6.2). Tokens:
 *   {SCHOOL_CODE}    the school's code, e.g. LEKHO
 *   {YEAR}           start year of the admission's academic year, e.g. 2026
 *   {YY}             its last two digits, e.g. 26
 *   {ACADEMIC_YEAR}  the academic year's code, e.g. 2026-27
 *   {SEQ}            the sequence, zero-padded to `sequencePadding` digits (required, once)
 * Everything else is literal: letters, digits and - / _ .
 */
export const ADMISSION_TOKENS = ['SCHOOL_CODE', 'YEAR', 'YY', 'ACADEMIC_YEAR', 'SEQ'] as const;

export function validateFormat(format: string): string | null {
  const tokens = [...format.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]!);
  const unknown = tokens.filter((t) => !ADMISSION_TOKENS.includes(t as never));
  if (unknown.length) return `Unknown token {${unknown[0]}}. Use ${ADMISSION_TOKENS.map((t) => `{${t}}`).join(', ')}.`;
  if (tokens.filter((t) => t === 'SEQ').length !== 1) return 'The format must contain {SEQ} exactly once.';
  const literal = format.replace(/\{[A-Z_]+\}/g, '');
  if (/[^A-Za-z0-9\-/_.]/.test(literal)) return 'Only letters, digits, hyphens, slashes, underscores and dots can be used between tokens.';
  return null;
}

interface YearInfo {
  id?: string;
  code: string;
  startYear: number;
}

function render(format: string, values: { schoolCode: string; year: YearInfo; seq?: number; padding: number }) {
  return format
    .replace(/\{SCHOOL_CODE\}/g, values.schoolCode)
    .replace(/\{YEAR\}/g, String(values.year.startYear))
    .replace(/\{YY\}/g, String(values.year.startYear).slice(-2))
    .replace(/\{ACADEMIC_YEAR\}/g, values.year.code)
    .replace(/\{SEQ\}/g, values.seq === undefined ? '{SEQ}' : String(values.seq).padStart(values.padding, '0'))
    .toUpperCase();
}

/** The academic year an admission belongs to: the one given, else current, else next planned, else the calendar year. */
async function admissionYear(organizationId: string, academicYearId?: string, session?: ClientSession): Promise<YearInfo> {
  const year = academicYearId
    ? await AcademicYearModel.findOne({ _id: academicYearId, organizationId }).session(session ?? null).lean()
    : ((await AcademicYearModel.findOne({ organizationId, status: 'active' }).session(session ?? null).lean()) ??
      (await AcademicYearModel.findOne({ organizationId, status: 'planned' }).sort({ startDate: 1 }).session(session ?? null).lean()));
  if (year) return { id: String(year._id), code: year.code, startYear: year.startDate.getUTCFullYear() };
  const now = new Date().getUTCFullYear();
  return { code: String(now), startYear: now };
}

type SettingsLike = { admissionNumber?: { format: string; sequencePadding: number } | null; casteCategories: string[]; allowUndisclosedGender: boolean; updatedAt?: Date | null };

/** Format and padding, with defaults for documents created before a field existed. */
const formatOf = (s: SettingsLike) => ({ format: s.admissionNumber?.format ?? DEFAULT_ADMISSION_FORMAT, sequencePadding: s.admissionNumber?.sequencePadding ?? 4 });

const toPublicSettings = (s: SettingsLike) => ({
  admissionNumber: formatOf(s),
  casteCategories: s.casteCategories,
  allowUndisclosedGender: s.allowUndisclosedGender,
  updatedAt: s.updatedAt ?? null,
});

export const studentSettingsService = {
  /** The school's settings, created with defaults on first use. */
  async load(organizationId: string, session?: ClientSession) {
    const existing = await StudentSettingsModel.findOne({ organizationId }).session(session ?? null).lean();
    if (existing) return existing;
    await StudentSettingsModel.updateOne(
      { organizationId },
      { $setOnInsert: { organizationId, admissionNumber: { format: DEFAULT_ADMISSION_FORMAT, sequencePadding: 4 }, casteCategories: [...DEFAULT_CASTE_CATEGORIES], allowUndisclosedGender: true } },
      { upsert: true, session },
    );
    return (await StudentSettingsModel.findOne({ organizationId }).session(session ?? null).lean())!;
  },

  async get(organizationId: string) {
    const settings = await this.load(organizationId);
    return { ...toPublicSettings(settings), admissionNumberPreview: await admissionService.preview(organizationId) };
  },

  async update(ctx: OrgActor, input: { admissionNumber?: { format?: string; sequencePadding?: number }; casteCategories?: string[]; allowUndisclosedGender?: boolean }) {
    const before = toPublicSettings(await this.load(ctx.organizationId));
    const set: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (input.admissionNumber?.format !== undefined) {
      const problem = validateFormat(input.admissionNumber.format);
      if (problem) throw ApiError.badRequest(problem, { format: [problem] });
      set['admissionNumber.format'] = input.admissionNumber.format;
    }
    if (input.admissionNumber?.sequencePadding !== undefined) set['admissionNumber.sequencePadding'] = input.admissionNumber.sequencePadding;
    if (input.casteCategories) set.casteCategories = [...new Map(input.casteCategories.map((c) => [c.toLowerCase(), c])).values()];
    if (input.allowUndisclosedGender !== undefined) set.allowUndisclosedGender = input.allowUndisclosedGender;
    await StudentSettingsModel.updateOne({ organizationId: ctx.organizationId }, { $set: set });
    const after = await this.get(ctx.organizationId);
    await audit(ctx, 'student_settings.updated', ctx.organizationId, { before, after: toPublicSettings(after) });
    return after;
  },
};

export const admissionService = {
  /** What the next admission number would look like (not reserved). */
  async preview(organizationId: string, academicYearId?: string) {
    const [settings, org, year] = await Promise.all([
      studentSettingsService.load(organizationId),
      OrganizationModel.findById(organizationId, { code: 1 }).lean(),
      admissionYear(organizationId, academicYearId),
    ]);
    const { format, sequencePadding } = formatOf(settings);
    const key = render(format, { schoolCode: org?.code ?? '', year, padding: sequencePadding });
    const counter = await AdmissionCounterModel.findOne({ organizationId, key }, { currentSequence: 1 }).lean();
    return render(format, { schoolCode: org?.code ?? '', year, seq: (counter?.currentSequence ?? 0) + 1, padding: sequencePadding });
  },

  /**
   * Issues the next admission number inside the caller's transaction (FRD §6.4): an atomic
   * $inc on the counter, never a document count. A number already taken (e.g. by a manual
   * correction) is skipped, and the unique index is the final guard against duplicates.
   */
  async issue(organizationId: string, session: ClientSession, academicYearId?: string): Promise<string> {
    // Sequential on purpose: a transaction session can't run operations in parallel.
    const settings = await studentSettingsService.load(organizationId, session);
    const org = await OrganizationModel.findById(organizationId, { code: 1 }).session(session).lean();
    const year = await admissionYear(organizationId, academicYearId, session);
    const { format, sequencePadding } = formatOf(settings);
    const key = render(format, { schoolCode: org?.code ?? '', year, padding: sequencePadding });
    for (let attempt = 0; attempt < 20; attempt++) {
      const counter = await AdmissionCounterModel.findOneAndUpdate(
        { organizationId, key },
        { $inc: { currentSequence: 1 }, $setOnInsert: { academicYearId: year.id } },
        { upsert: true, returnDocument: 'after', session },
      ).lean();
      const number = render(format, { schoolCode: org?.code ?? '', year, seq: counter!.currentSequence, padding: sequencePadding });
      const taken = await StudentModel.exists({ organizationId, admissionNumber: number }).collation({ locale: 'en', strength: 2 }).session(session);
      if (!taken) return number;
    }
    throw ApiError.conflict('Could not issue a unique admission number. Check the admission number format.');
  },

  async get(organizationId: string, studentId: string) {
    const s = await findStudent(organizationId, studentId, { includeArchived: true });
    return {
      admissionNumber: s.admissionNumber ?? null,
      admittedAt: s.admittedAt ?? null,
      history: s.admissionNumberHistory.map((h) => ({ from: h.from, to: h.to, reason: h.reason, changedBy: String(h.changedBy), changedAt: h.changedAt })),
    };
  },

  /**
   * Exceptional correction of an issued number (FRD §6.4), with a reason kept on the record and
   * in the audit log. The old number stays retired: counters never go back, so it isn't reissued.
   */
  async correct(ctx: OrgActor, studentId: string, input: { admissionNumber: string; reason: string }) {
    const next = input.admissionNumber.trim().toUpperCase();
    await inTransaction(async (session) => {
      const s = await findStudent(ctx.organizationId, studentId, { includeArchived: true, session });
      if (!s.admissionNumber) throw ApiError.conflict('This student has no admission number yet. It is issued when registration is completed.');
      if (s.admissionNumber === next) return;
      const clash = await StudentModel.exists({ organizationId: ctx.organizationId, admissionNumber: next, _id: { $ne: s._id } }).collation({ locale: 'en', strength: 2 }).session(session);
      // Numbers retired by earlier corrections are also off limits.
      const retired = await StudentModel.exists({ organizationId: ctx.organizationId, 'admissionNumberHistory.from': next }).session(session);
      if (clash || retired) throw ApiError.conflict(`Admission number ${next} is already in use.`, { admissionNumber: ['Already used'] });
      const from = s.admissionNumber;
      s.admissionNumberHistory.push({ from, to: next, reason: input.reason, changedBy: ctx.actorId as never, changedAt: new Date() });
      s.admissionNumber = next;
      s.updatedBy = ctx.actorId as never;
      await s.save({ session });
      await audit(ctx, 'student.admission_number_corrected', studentId, { before: { admissionNumber: from }, after: { admissionNumber: next }, metadata: { reason: input.reason } }, session);
    });
    return this.get(ctx.organizationId, studentId);
  },
};
