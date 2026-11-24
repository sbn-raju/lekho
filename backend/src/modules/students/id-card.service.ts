import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { ApiError } from '../../common/errors/ApiError.js';
import { inTransaction } from '../../common/utils/transaction.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { AcademicYearModel } from '../academics/academic-year.model.js';
import { SchoolClassModel } from '../academics/class.model.js';
import { resolveYear } from '../academics/academics.shared.js';
import { imagekit } from '../uploads/imagekit.client.js';
import { DEFAULT_ID_CARD_FIELDS, IdCardTemplateModel, StudentAssignmentModel, StudentIdCardModel, type IdCardField, type IdCardTemplate } from './assignment.model.js';
import { assignmentService, type PublicAssignment } from './assignment.service.js';
import { GuardianModel, isGuardianVerified } from './guardian.model.js';
import { photoView } from './photo.service.js';
import { StudentModel, day, fullName, type StudentLike } from './student.model.js';
import { audit, findStudent, oid } from './students.shared.js';

type TemplateLike = IdCardTemplate & { _id?: Types.ObjectId };

/** Built-in template used until the school creates its own (FRD §8.3 "standard template"). */
const STANDARD: TemplateLike = {
  organizationId: undefined as never,
  name: 'Standard',
  layout: 'portrait',
  primaryColor: '#1F4FD8',
  accentColor: '#F5B700',
  textColor: '#1A1D23',
  backgroundColor: '#FFFFFF',
  photoPosition: 'center',
  fields: [...DEFAULT_ID_CARD_FIELDS],
  showBackSide: false,
  backText: undefined,
  signatureLabel: 'Principal',
  validUntil: undefined,
  isDefault: true,
  createdBy: undefined as never,
  updatedBy: undefined,
  createdAt: undefined as never,
  updatedAt: undefined as never,
};

export const MAX_BULK_CARDS = 500;

const toPublicTemplate = (t: TemplateLike) => ({
  id: t._id ? String(t._id) : 'standard',
  name: t.name,
  layout: t.layout,
  primaryColor: t.primaryColor,
  accentColor: t.accentColor,
  textColor: t.textColor,
  backgroundColor: t.backgroundColor,
  photoPosition: t.photoPosition,
  fields: t.fields,
  showBackSide: t.showBackSide,
  backText: t.backText ?? null,
  signatureLabel: t.signatureLabel ?? null,
  validUntil: day(t.validUntil),
  isDefault: t.isDefault,
  builtIn: !t._id,
  createdAt: t.createdAt ?? null,
  updatedAt: t.updatedAt ?? null,
});

export type TemplateInput = Partial<Omit<ReturnType<typeof toPublicTemplate>, 'id' | 'builtIn' | 'createdAt' | 'updatedAt' | 'validUntil'>> & { validUntil?: Date | null };

async function loadTemplate(organizationId: string, templateId?: string): Promise<TemplateLike> {
  if (templateId && templateId !== 'standard') {
    const t = Types.ObjectId.isValid(templateId) ? await IdCardTemplateModel.findOne({ _id: templateId, organizationId }).lean() : null;
    if (!t) throw ApiError.notFound('ID card template not found');
    return t as TemplateLike;
  }
  if (templateId === 'standard') return STANDARD;
  return ((await IdCardTemplateModel.findOne({ organizationId, isDefault: true }).lean()) as TemplateLike | null) ?? STANDARD;
}

/** Card content for one student. Only ID-card fields are read: nothing sensitive is reachable. */
interface CardData {
  studentId: string;
  assignmentId: string;
  name: string;
  admissionNumber: string;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  className: string;
  sectionName: string;
  academicYear: string;
  emergencyContact: string | null;
  validUntil: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  photoVersion: number | null;
}

interface SchoolData {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  code: string;
}

async function schoolData(organizationId: string): Promise<SchoolData> {
  const org = await OrganizationModel.findById(organizationId).lean();
  if (!org) throw ApiError.notFound('School not found');
  const a = org.address ?? {};
  return {
    name: org.name,
    code: org.code,
    address: [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(', '),
    phone: org.contact?.phone ?? null,
    email: org.contact?.email ?? null,
  };
}

/** Why a student can't get a card, or null if they can. */
function ineligible(s: StudentLike, assignment: PublicAssignment | undefined): string | null {
  if (s.registrationStatus !== 'completed' || !s.admissionNumber) return 'registration_incomplete';
  if (s.deletedAt) return 'archived';
  if (!assignment || assignment.status !== 'active') return 'no_current_placement';
  if (!s.photo) return 'no_photo';
  return null;
}

const REASON_TEXT: Record<string, string> = {
  registration_incomplete: 'Registration is not complete.',
  archived: 'The student is archived.',
  no_current_placement: 'The student is not placed in a class for the academic year.',
  no_photo: 'The student has no photograph.',
};

async function buildCards(organizationId: string, students: StudentLike[], template: TemplateLike, academicYearId?: string) {
  const ids = students.map((s) => String(s._id));
  const assignments = await assignmentService.current(organizationId, ids, academicYearId);
  const needEmergency = template.fields.includes('emergencyContact');
  const guardians = needEmergency ? await GuardianModel.find({ organizationId, studentId: { $in: ids.map(oid) } }).lean() : [];
  const yearIds = [...new Set([...assignments.values()].map((a) => a.academicYear?.id).filter(Boolean))] as string[];
  const years = new Map((await AcademicYearModel.find({ _id: { $in: yearIds.map(oid) } }, { endDate: 1 }).lean()).map((y) => [String(y._id), y.endDate]));
  const cards: CardData[] = [];
  const skipped: { studentId: string; name: string; reason: string; message: string }[] = [];
  for (const s of students) {
    const a = assignments.get(String(s._id));
    const reason = ineligible(s, a);
    if (reason) {
      skipped.push({ studentId: String(s._id), name: fullName(s), reason, message: REASON_TEXT[reason]! });
      continue;
    }
    // Only verified numbers may be printed as an emergency contact (FRD §4.2 rule 6).
    const mine = guardians.filter((g) => String(g.studentId) === String(s._id) && isGuardianVerified(g));
    const emergency = mine.find((g) => g.isEmergencyContact) ?? mine.find((g) => g.isPrimaryContact) ?? mine[0];
    const validUntil = template.validUntil ?? (a!.academicYear ? years.get(a!.academicYear.id) : undefined);
    cards.push({
      studentId: String(s._id),
      assignmentId: a!.id,
      name: fullName(s),
      admissionNumber: s.admissionNumber!,
      dateOfBirth: day(s.dateOfBirth),
      bloodGroup: s.bloodGroup ?? null,
      className: a!.class?.name ?? '',
      sectionName: a!.section?.name ?? '',
      academicYear: a!.academicYear?.name ?? '',
      emergencyContact: emergency?.mobileNumber ?? null,
      validUntil: day(validUntil),
      photoPath: s.photo?.filePath ?? null,
      photoUrl: photoView(s.photo)?.url ?? null,
      photoVersion: s.photo?.version ?? null,
    });
  }
  return { cards, skipped };
}

// ---------- PDF rendering ----------

/** CR80 card size in PDF points (54 × 85.6 mm). */
const CARD = { short: 153, long: 242.6 };
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

async function fetchPhotos(cards: CardData[]) {
  const out = new Map<string, Buffer | null>();
  // A few at a time, to be gentle with the CDN on big batches.
  for (let i = 0; i < cards.length; i += 8) {
    await Promise.all(
      cards.slice(i, i + 8).map(async (c) => {
        out.set(c.studentId, c.photoPath ? await imagekit.fetchImage(c.photoPath, 'w-360,h-480,fo-face,f-jpg,q-85') : null);
      }),
    );
  }
  return out;
}

function drawFront(doc: PDFKit.PDFDocument, x: number, y: number, t: TemplateLike, school: SchoolData, c: CardData, photo: Buffer | null) {
  const portrait = t.layout === 'portrait';
  const w = portrait ? CARD.short : CARD.long;
  const h = portrait ? CARD.long : CARD.short;
  const show = (f: IdCardField) => t.fields.includes(f);
  doc.save();
  doc.roundedRect(x, y, w, h, 8).clip();
  doc.rect(x, y, w, h).fill(t.backgroundColor);

  // Header band: school name and address.
  const headerH = portrait ? 46 : 38;
  doc.rect(x, y, w, headerH).fill(t.primaryColor);
  doc.rect(x, y + headerH, w, 2.5).fill(t.accentColor);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5).text(school.name, x + 8, y + 7, { width: w - 16, align: 'center', height: 22, ellipsis: true });
  if (show('schoolAddress') && school.address) doc.font('Helvetica').fontSize(5.5).text(school.address, x + 8, y + (portrait ? 30 : 24), { width: w - 16, align: 'center', height: 14, ellipsis: true });

  // Photo.
  const pw = portrait ? 62 : 56;
  const ph = pw * (4 / 3);
  const px = portrait ? (t.photoPosition === 'left' ? x + 10 : t.photoPosition === 'right' ? x + w - pw - 10 : x + (w - pw) / 2) : t.photoPosition === 'right' ? x + w - pw - 10 : x + 10;
  const py = y + headerH + 8;
  doc.roundedRect(px - 1.5, py - 1.5, pw + 3, ph + 3, 4).fill(t.accentColor);
  let drawn = false;
  if (photo) {
    try {
      doc.save();
      doc.roundedRect(px, py, pw, ph, 3).clip();
      doc.image(photo, px, py, { cover: [pw, ph], align: 'center', valign: 'center' });
      doc.restore();
      drawn = true;
    } catch {
      doc.restore();
    }
  }
  if (!drawn) {
    doc.roundedRect(px, py, pw, ph, 3).fill('#E7EAF0');
    doc.fillColor('#7A8494').font('Helvetica-Bold').fontSize(18).text(initials(c.name), px, py + ph / 2 - 9, { width: pw, align: 'center' });
  }

  // Details.
  const dx = portrait ? x + 10 : t.photoPosition === 'right' ? x + 10 : px + pw + 10;
  const dw = portrait ? w - 20 : w - pw - 30;
  let dy = portrait ? py + ph + 8 : py;
  doc.fillColor(t.textColor).font('Helvetica-Bold').fontSize(portrait ? 9.5 : 9).text(c.name, dx, dy, { width: dw, align: portrait ? 'center' : 'left', height: 24, ellipsis: true });
  dy = doc.y + 3;
  const rows: [string, string][] = [];
  if (show('admissionNumber')) rows.push(['Adm. No', c.admissionNumber]);
  if (show('class') || show('section')) rows.push(['Class', [show('class') ? c.className : '', show('section') ? c.sectionName : ''].filter(Boolean).join(' – ')]);
  if (show('academicYear')) rows.push(['Year', c.academicYear]);
  if (show('dateOfBirth') && c.dateOfBirth) rows.push(['DOB', fmtDate(c.dateOfBirth)]);
  if (show('bloodGroup') && c.bloodGroup) rows.push(['Blood', c.bloodGroup]);
  if (show('emergencyContact') && c.emergencyContact) rows.push(['Emergency', c.emergencyContact]);
  if (show('validUntil') && c.validUntil) rows.push(['Valid till', fmtDate(c.validUntil)]);
  const labelW = 42;
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(6.5).fillColor('#5B6472').text(label, dx, dy, { width: labelW });
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(t.textColor).text(value, dx + labelW, dy, { width: dw - labelW, height: 9, ellipsis: true });
    dy += 9.5;
  }

  // Footer: contact and signature line.
  const footH = 16;
  doc.rect(x, y + h - footH, w, footH).fill(t.primaryColor);
  const contact = [show('schoolPhone') ? school.phone : null, show('schoolEmail') ? school.email : null].filter(Boolean).join('  ·  ');
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(5.5).text(contact, x + 8, y + h - footH + 5.5, { width: w * 0.6, height: 8, ellipsis: true });
  if (t.signatureLabel) {
    const sx = x + w - 58;
    doc.moveTo(sx, y + h - footH - 6).lineTo(x + w - 8, y + h - footH - 6).lineWidth(0.5).strokeColor('#9AA3B2').stroke();
    doc.fillColor('#5B6472').font('Helvetica').fontSize(5).text(t.signatureLabel, sx, y + h - footH - 4.5, { width: 50, align: 'center' });
  }
  doc.restore();
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.4).strokeColor('#C9CED8').stroke();
}

function drawBack(doc: PDFKit.PDFDocument, x: number, y: number, t: TemplateLike, school: SchoolData, c: CardData) {
  const portrait = t.layout === 'portrait';
  const w = portrait ? CARD.short : CARD.long;
  const h = portrait ? CARD.long : CARD.short;
  doc.save();
  doc.roundedRect(x, y, w, h, 8).clip();
  doc.rect(x, y, w, h).fill(t.backgroundColor);
  doc.rect(x, y, w, 6).fill(t.primaryColor);
  let dy = y + 16;
  doc.fillColor(t.textColor).font('Helvetica-Bold').fontSize(8).text(school.name, x + 10, dy, { width: w - 20, align: 'center' });
  dy = doc.y + 6;
  if (t.backText) {
    doc.font('Helvetica').fontSize(6.5).fillColor(t.textColor).text(t.backText, x + 10, dy, { width: w - 20, align: 'center', height: h / 2, ellipsis: true });
    dy = doc.y + 6;
  }
  const lines = [
    t.fields.includes('emergencyContact') && c.emergencyContact ? `Emergency contact: ${c.emergencyContact}` : null,
    school.address ? `If found, please return to: ${school.address}` : null,
    school.phone ? `Phone: ${school.phone}` : null,
  ].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(6).fillColor('#5B6472');
  for (const l of lines) {
    doc.text(l, x + 10, dy, { width: w - 20, align: 'center' });
    dy = doc.y + 3;
  }
  doc.rect(x, y + h - 6, w, 6).fill(t.accentColor);
  doc.restore();
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.4).strokeColor('#C9CED8').stroke();
}

/** Collects a document's output; call `doc.end()` after drawing, then await the promise. */
function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** One card per page at card size: front, then back if the template has one. */
async function renderSingle(t: TemplateLike, school: SchoolData, c: CardData, photo: Buffer | null) {
  const size: [number, number] = t.layout === 'portrait' ? [CARD.short, CARD.long] : [CARD.long, CARD.short];
  const doc = new PDFDocument({ size, margin: 0, info: { Title: `ID card – ${c.name}`, Author: school.name } });
  const done = collect(doc);
  drawFront(doc, 0, 0, t, school, c, photo);
  if (t.showBackSide) {
    doc.addPage({ size, margin: 0 });
    drawBack(doc, 0, 0, t, school, c);
  }
  doc.end();
  return done;
}

/**
 * Print sheet: cards laid out on A4 with cut gaps (3 × 3 portrait, 2 × 5 landscape). With a
 * back side, each sheet of fronts is followed by a mirrored sheet of backs for duplex printing.
 */
async function renderSheet(t: TemplateLike, school: SchoolData, cards: CardData[], photos: Map<string, Buffer | null>) {
  const portrait = t.layout === 'portrait';
  const [cw, ch] = portrait ? [CARD.short, CARD.long] : [CARD.long, CARD.short];
  const A4 = { w: 595.28, h: 841.89 };
  const gap = 10;
  const cols = Math.floor((A4.w - 40 + gap) / (cw + gap));
  const rows = Math.floor((A4.h - 40 + gap) / (ch + gap));
  const perPage = cols * rows;
  const ox = (A4.w - (cols * cw + (cols - 1) * gap)) / 2;
  const oy = (A4.h - (rows * ch + (rows - 1) * gap)) / 2;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `ID cards – ${school.name}`, Author: school.name } });
  const done = collect(doc);
  for (let p = 0; p < cards.length; p += perPage) {
    const page = cards.slice(p, p + perPage);
    doc.addPage({ size: 'A4', margin: 0 });
    page.forEach((c, i) => drawFront(doc, ox + (i % cols) * (cw + gap), oy + Math.floor(i / cols) * (ch + gap), t, school, c, photos.get(c.studentId) ?? null));
    if (t.showBackSide) {
      doc.addPage({ size: 'A4', margin: 0 });
      page.forEach((c, i) => drawBack(doc, ox + (cols - 1 - (i % cols)) * (cw + gap), oy + Math.floor(i / cols) * (ch + gap), t, school, c));
    }
  }
  doc.end();
  return done;
}

async function record(ctx: OrgActor, cards: CardData[], templateId: string | undefined, batchId?: string) {
  if (cards.length === 0) return;
  const latest = await StudentIdCardModel.aggregate<{ _id: Types.ObjectId; v: number }>([
    { $match: { organizationId: oid(ctx.organizationId), studentId: { $in: cards.map((c) => oid(c.studentId)) } } },
    { $group: { _id: '$studentId', v: { $max: '$version' } } },
  ]);
  const versionOf = new Map(latest.map((l) => [String(l._id), l.v]));
  const now = new Date();
  await inTransaction(async (session) => {
    await StudentIdCardModel.insertMany(
      cards.map((c) => ({
        organizationId: ctx.organizationId,
        studentId: c.studentId,
        academicAssignmentId: c.assignmentId,
        templateId: templateId && templateId !== 'standard' ? templateId : undefined,
        batchId,
        version: (versionOf.get(c.studentId) ?? 0) + 1,
        generatedBy: ctx.actorId,
        generatedAt: now,
      })),
      { session },
    );
    if (batchId) await audit(ctx, 'id_card.bulk_generated', batchId, { metadata: { count: cards.length, templateId: templateId ?? null } }, session);
    else await audit(ctx, 'id_card.generated', cards[0]!.studentId, { metadata: { studentId: cards[0]!.studentId, templateId: templateId ?? null } }, session);
  });
}

const safeFileName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

export const idCardService = {
  async listTemplates(organizationId: string) {
    const rows = (await IdCardTemplateModel.find({ organizationId }).sort({ isDefault: -1, name: 1 }).lean()) as TemplateLike[];
    const standard = { ...STANDARD, isDefault: !rows.some((r) => r.isDefault) };
    return [toPublicTemplate(standard), ...rows.map(toPublicTemplate)];
  },

  async createTemplate(ctx: OrgActor, input: TemplateInput & { name: string }) {
    const id = await inTransaction(async (session) => {
      if (input.isDefault) await IdCardTemplateModel.updateMany({ organizationId: ctx.organizationId, isDefault: true }, { $set: { isDefault: false } }, { session });
      const [t] = await IdCardTemplateModel.create([{ ...input, validUntil: input.validUntil ?? undefined, backText: input.backText ?? undefined, organizationId: ctx.organizationId, createdBy: ctx.actorId }], { session });
      await audit(ctx, 'id_card_template.created', String(t!._id), { after: { name: t!.name, isDefault: t!.isDefault } }, session);
      return String(t!._id);
    });
    return toPublicTemplate((await IdCardTemplateModel.findById(id).lean()) as TemplateLike);
  },

  async updateTemplate(ctx: OrgActor, templateId: string, input: TemplateInput) {
    if (templateId === 'standard') throw ApiError.badRequest('The standard template cannot be edited. Create your own template instead.');
    await inTransaction(async (session) => {
      const t = Types.ObjectId.isValid(templateId) ? await IdCardTemplateModel.findOne({ _id: templateId, organizationId: ctx.organizationId }).session(session) : null;
      if (!t) throw ApiError.notFound('ID card template not found');
      if (input.isDefault === true) await IdCardTemplateModel.updateMany({ organizationId: ctx.organizationId, isDefault: true, _id: { $ne: t._id } }, { $set: { isDefault: false } }, { session });
      const { validUntil, backText, signatureLabel, ...rest } = input;
      t.set(rest);
      if (validUntil !== undefined) t.validUntil = validUntil ?? undefined;
      if (backText !== undefined) t.backText = backText ?? undefined;
      if (signatureLabel !== undefined) t.signatureLabel = signatureLabel ?? undefined;
      t.updatedBy = oid(ctx.actorId);
      await t.save({ session });
      await audit(ctx, 'id_card_template.updated', templateId, { metadata: { changedFields: Object.keys(input) } }, session);
    });
    return toPublicTemplate((await IdCardTemplateModel.findById(templateId).lean()) as TemplateLike);
  },

  async deleteTemplate(ctx: OrgActor, templateId: string) {
    const t = Types.ObjectId.isValid(templateId) ? await IdCardTemplateModel.findOne({ _id: templateId, organizationId: ctx.organizationId }) : null;
    if (!t) throw ApiError.notFound('ID card template not found');
    await t.deleteOne();
    await audit(ctx, 'id_card_template.deleted', templateId, { before: { name: t.name } });
  },

  /** Preview data for one card (FRD §8.4 steps 3–7): what would be printed, or why it can't be. */
  async preview(organizationId: string, studentId: string, templateId?: string) {
    const s = await findStudent(organizationId, studentId);
    const template = await loadTemplate(organizationId, templateId);
    const [school, built] = await Promise.all([schoolData(organizationId), buildCards(organizationId, [s.toObject() as StudentLike], template)]);
    const card = built.cards[0] ?? null;
    return {
      template: toPublicTemplate(template),
      school,
      card: card && { ...card, photoPath: undefined },
      eligible: Boolean(card),
      problems: built.skipped.map((k) => ({ reason: k.reason, message: k.message })),
    };
  },

  async generate(ctx: OrgActor, studentId: string, input: { templateId?: string }) {
    const s = await findStudent(ctx.organizationId, studentId);
    const template = await loadTemplate(ctx.organizationId, input.templateId);
    const [school, built] = await Promise.all([schoolData(ctx.organizationId), buildCards(ctx.organizationId, [s.toObject() as StudentLike], template)]);
    const card = built.cards[0];
    if (!card) {
      const k = built.skipped[0]!;
      throw ApiError.conflict(`An ID card can't be generated yet: ${k.message.charAt(0).toLowerCase()}${k.message.slice(1)}`, { reason: k.reason });
    }
    const photos = await fetchPhotos([card]);
    const pdf = await renderSingle(template, school, card, photos.get(card.studentId) ?? null);
    await record(ctx, [card], template._id ? String(template._id) : undefined);
    return { pdf, fileName: `id-card-${safeFileName(card.admissionNumber)}.pdf` };
  },

  /**
   * Bulk cards for a class, section, year or explicit list (FRD §8.5), within the actor's scope.
   * Only active students by default. `dryRun` reports who would be included or skipped.
   */
  async bulk(
    ctx: OrgActor,
    input: { academicYearId?: string; classId?: string; sectionId?: string; studentIds?: string[]; includeInactive?: boolean; templateId?: string; dryRun?: boolean },
    scopeFilter: Record<string, unknown> | null,
  ) {
    const template = await loadTemplate(ctx.organizationId, input.templateId);
    const year = await resolveYear(ctx.organizationId, input.academicYearId);
    if (!year) throw ApiError.badRequest('There is no academic year to generate cards for.');
    const af: Record<string, unknown> = { organizationId: oid(ctx.organizationId), academicYearId: year._id, status: 'active' };
    if (input.classId) af.classId = oid(input.classId);
    if (input.sectionId) af.sectionId = oid(input.sectionId);
    const filter: Record<string, unknown> = {
      organizationId: oid(ctx.organizationId),
      deletedAt: null,
      status: input.includeInactive ? { $in: ['active', 'inactive'] } : 'active',
      $and: [{ _id: { $in: await StudentAssignmentModel.distinct('studentId', af) } }, ...(scopeFilter ? [scopeFilter] : [])],
    };
    if (input.studentIds) (filter.$and as unknown[]).push({ _id: { $in: input.studentIds.filter((id) => Types.ObjectId.isValid(id)).map(oid) } });
    const total = await StudentModel.countDocuments(filter);
    if (total > MAX_BULK_CARDS) throw ApiError.badRequest(`That is ${total} students; generate at most ${MAX_BULK_CARDS} cards at a time (pick a class or section).`, { reason: 'too_many' });
    const students = (await StudentModel.find(filter).sort({ searchName: 1 }).lean()) as StudentLike[];
    const built = await buildCards(ctx.organizationId, students, template, String(year._id));
    const order = await this.classOrder(ctx.organizationId);
    built.cards.sort((a, b) => (order.get(a.className) ?? 0) - (order.get(b.className) ?? 0) || a.className.localeCompare(b.className) || a.sectionName.localeCompare(b.sectionName) || a.name.localeCompare(b.name));
    const summary = { academicYear: { id: String(year._id), name: year.name }, eligible: built.cards.length, skipped: built.skipped };
    if (input.dryRun) return { summary, pdf: null, fileName: null };
    if (built.cards.length === 0) throw ApiError.conflict('None of the selected students can get an ID card yet.', { reason: 'nothing_to_generate', skipped: built.skipped });
    const school = await schoolData(ctx.organizationId);
    const photos = await fetchPhotos(built.cards);
    const pdf = await renderSheet(template, school, built.cards, photos);
    const batchId = randomUUID();
    await record(ctx, built.cards, template._id ? String(template._id) : undefined, batchId);
    return { summary, pdf, fileName: `id-cards-${safeFileName(school.code)}-${safeFileName(year.code)}.pdf` };
  },

  async classOrder(organizationId: string) {
    return new Map((await SchoolClassModel.find({ organizationId }, { name: 1, displayOrder: 1 }).lean()).map((c) => [c.name, c.displayOrder]));
  },
};
