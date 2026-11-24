import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/utils/logger.js';

/** The subset of ImageKit's file object this module relies on. */
export interface ImageKitFile {
  fileId: string;
  name: string;
  filePath: string;
  mime?: string;
  size: number;
  width?: number;
  height?: number;
  isPrivateFile?: boolean;
  fileType?: string;
}

const API = 'https://api.imagekit.io/v1';
/** ImageKit rejects client upload signatures that expire more than an hour ahead. */
const UPLOAD_AUTH_TTL_SECONDS = 30 * 60;

export const isImageKitConfigured = () => Boolean(env.IMAGEKIT_PRIVATE_KEY && env.IMAGEKIT_PUBLIC_KEY && env.IMAGEKIT_URL_ENDPOINT);

function requireConfig() {
  if (!isImageKitConfigured()) throw new ApiError('SERVICE_UNAVAILABLE', 'Photo storage is not configured for this server.');
  return { privateKey: env.IMAGEKIT_PRIVATE_KEY!, publicKey: env.IMAGEKIT_PUBLIC_KEY!, endpoint: env.IMAGEKIT_URL_ENDPOINT!.replace(/\/+$/, '') };
}

const basicAuth = (privateKey: string) => `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}`;

async function api(method: 'GET' | 'DELETE', path: string): Promise<Response> {
  const { privateKey } = requireConfig();
  try {
    return await fetch(`${API}${path}`, { method, headers: { Authorization: basicAuth(privateKey) }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    logger.error(`ImageKit ${method} ${path.split('/').slice(0, 3).join('/')} failed`, err);
    throw new ApiError('SERVICE_UNAVAILABLE', 'Photo storage is unavailable. Please try again shortly.');
  }
}

/**
 * Minimal ImageKit client over the REST API. Kept as one object so tests can stub its methods.
 * The private key never leaves the server: the browser gets one-time upload signatures and
 * short-lived signed delivery URLs only.
 */
export const imagekit = {
  /** One-time client upload parameters (V1): signature = HMAC-SHA1(privateKey, token + expire). */
  uploadAuth() {
    const { privateKey, publicKey, endpoint } = requireConfig();
    const token = randomUUID();
    const expire = Math.floor(Date.now() / 1000) + UPLOAD_AUTH_TTL_SECONDS;
    const signature = createHmac('sha1', privateKey).update(`${token}${expire}`).digest('hex');
    return { token, expire, signature, publicKey, urlEndpoint: endpoint };
  },

  async getFile(fileId: string): Promise<ImageKitFile | null> {
    const res = await api('GET', `/files/${encodeURIComponent(fileId)}/details`);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new ApiError('SERVICE_UNAVAILABLE', 'Photo storage is unavailable. Please try again shortly.');
    return (await res.json()) as ImageKitFile;
  },

  /** Deletes a file; a file that is already gone counts as deleted. */
  async deleteFile(fileId: string): Promise<void> {
    const res = await api('DELETE', `/files/${encodeURIComponent(fileId)}`);
    if (!res.ok && res.status !== 404) throw new ApiError('SERVICE_UNAVAILABLE', 'Photo storage is unavailable. Please try again shortly.');
  },

  /**
   * Signed, expiring delivery URL for a (private) file, with optional transformations such as
   * "w-120,h-160,fo-face". Expiry is rounded up to a window so the same URL is reused (and
   * browser-cached) for a while instead of changing on every request.
   */
  signedUrl(filePath: string, transformation?: string, ttlSeconds = env.IMAGEKIT_SIGNED_URL_TTL_SECONDS): string | null {
    if (!isImageKitConfigured()) return null;
    const { privateKey, endpoint } = requireConfig();
    const window = Math.max(60, Math.floor(ttlSeconds / 4));
    const expiry = Math.ceil((Date.now() / 1000 + ttlSeconds) / window) * window;
    const path = filePath.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    const relative = `${transformation ? `tr:${transformation}/` : ''}${path}`;
    const signature = createHmac('sha1', privateKey).update(`${relative}${expiry}`).digest('hex');
    return `${endpoint}/${relative}?ik-t=${expiry}&ik-s=${signature}`;
  },

  /** Downloads a transformed rendition (e.g. a JPEG for PDF ID cards). Null when unavailable. */
  async fetchImage(filePath: string, transformation: string): Promise<Buffer | null> {
    const url = this.signedUrl(filePath, transformation, 300);
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  },

  /** Folder holding one student's photos. */
  studentFolder(organizationId: string, studentId: string) {
    return `${env.IMAGEKIT_ROOT_FOLDER.replace(/\/+$/, '')}/${organizationId}/students/${studentId}`;
  },
};
