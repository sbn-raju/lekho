import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/utils/logger.js';
import type { OrgActor } from '../memberships/membership.service.js';
import { imagekit } from '../uploads/imagekit.client.js';
import { StudentModel, type Student } from './student.model.js';
import { assertNotArchived, audit, findStudent } from './students.shared.js';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_RECOMMENDED = { width: 300, height: 400, aspectRatio: '3:4' } as const;

/** Signed, expiring URLs for a student's photo. Null when there's no photo (or no ImageKit). */
export function photoView(photo: Student['photo'] | null | undefined) {
  if (!photo) return null;
  return {
    url: imagekit.signedUrl(photo.filePath, 'w-600,h-800,c-at_max'),
    thumbnailUrl: imagekit.signedUrl(photo.filePath, 'w-96,h-128,c-maintain_ratio,fo-face'),
    width: photo.width ?? null,
    height: photo.height ?? null,
    mimeType: photo.mimeType,
    size: photo.size,
    version: photo.version,
    uploadedAt: photo.uploadedAt,
  };
}

async function discard(fileId: string, why: string) {
  try {
    await imagekit.deleteFile(fileId);
  } catch (err) {
    logger.warn(`Could not delete ImageKit file after ${why}`, err);
  }
}

export const photoService = {
  /**
   * Parameters for one direct browser → ImageKit upload (FRD §5.2). The private key stays on the
   * server; the client must upload as a private file into the student's folder, which `save`
   * then verifies.
   */
  async uploadAuth(ctx: OrgActor, studentId: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    const auth = imagekit.uploadAuth();
    return {
      ...auth,
      folder: imagekit.studentFolder(ctx.organizationId, studentId),
      fileName: `photo-${Date.now()}`,
      isPrivateFile: true,
      useUniqueFileName: true,
      constraints: { maxBytes: PHOTO_MAX_BYTES, mimeTypes: PHOTO_MIME_TYPES, recommended: PHOTO_RECOMMENDED },
    };
  },

  /**
   * Accepts an uploaded file as the student's photo. Upload signatures don't bind the folder or
   * privacy flag, so the file is checked against ImageKit itself: it must be a private image in
   * this student's folder within the size limit. Anything else is deleted and refused.
   */
  async save(ctx: OrgActor, studentId: string, fileId: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    if (student.photo?.fileId === fileId) return photoView(student.photo);
    const file = await imagekit.getFile(fileId);
    if (!file) throw ApiError.badRequest('The uploaded photo was not found. Upload it again.', { fileId: ['Not found'] });

    const folder = `${imagekit.studentFolder(ctx.organizationId, studentId)}/`;
    if (!file.filePath.startsWith(folder)) {
      // Not this student's folder: possibly another tenant's file. Don't touch it.
      throw ApiError.badRequest('This file was not uploaded for this student.', { fileId: ['Wrong folder'] });
    }
    const mime = file.mime ?? '';
    const problem = !PHOTO_MIME_TYPES.includes(mime as never)
      ? 'Upload a JPG, PNG or WebP image.'
      : file.size > PHOTO_MAX_BYTES
        ? 'The photo must be 5 MB or smaller.'
        : file.isPrivateFile !== true
          ? 'The photo must be uploaded as a private file.'
          : null;
    if (problem) {
      await discard(file.fileId, 'rejecting an upload');
      throw ApiError.badRequest(problem, { fileId: [problem] });
    }

    const previous = student.photo ? { fileId: student.photo.fileId, version: student.photo.version } : null;
    student.set('photo', {
      fileId: file.fileId,
      filePath: file.filePath,
      fileName: file.name,
      mimeType: mime,
      size: file.size,
      width: file.width,
      height: file.height,
      uploadedAt: new Date(),
      uploadedBy: ctx.actorId,
      version: (previous?.version ?? 0) + 1,
    });
    student.updatedBy = ctx.actorId as never;
    await student.save();
    if (previous && env.STUDENT_PHOTO_RETENTION === 'delete') await discard(previous.fileId, 'replacing a photo');
    await audit(ctx, previous ? 'student.photo_replaced' : 'student.photo_uploaded', studentId, {
      metadata: { mimeType: mime, size: file.size, width: file.width ?? null, height: file.height ?? null, previousRetained: previous ? env.STUDENT_PHOTO_RETENTION === 'retain' : null },
    });
    const small = (file.width ?? Infinity) < PHOTO_RECOMMENDED.width || (file.height ?? Infinity) < PHOTO_RECOMMENDED.height;
    return { ...photoView(student.photo)!, warnings: small ? [`The photo is smaller than the recommended ${PHOTO_RECOMMENDED.width}×${PHOTO_RECOMMENDED.height} pixels and may look blurry on ID cards.`] : [] };
  },

  async remove(ctx: OrgActor, studentId: string) {
    const student = await findStudent(ctx.organizationId, studentId, { includeArchived: true });
    assertNotArchived(student);
    if (!student.photo) return;
    const fileId = student.photo.fileId;
    await StudentModel.updateOne({ _id: student._id }, { $unset: { photo: 1 }, $set: { updatedBy: ctx.actorId } });
    if (env.STUDENT_PHOTO_RETENTION === 'delete') await discard(fileId, 'removing a photo');
    await audit(ctx, 'student.photo_removed', studentId, { metadata: { retained: env.STUDENT_PHOTO_RETENTION === 'retain' } });
  },
};
