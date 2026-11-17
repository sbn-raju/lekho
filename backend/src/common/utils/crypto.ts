import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 hex digest. Used for high-entropy random tokens (refresh, reset, verification),
 * where a fast hash is appropriate; passwords use Argon2id instead.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Canonical form used for uniqueness and lookups (FRD §6.4 rule 3). */
export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}
