import argon2 from 'argon2';

/**
 * Argon2id parameters. 64 MiB / 3 passes / 1 lane is above the OWASP minimum
 * (19 MiB, t=2, p=1); review against production hardware and adjust. Existing hashes are
 * upgraded transparently on the next successful login via `needsRehash`.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

let dummyHash: Promise<string> | undefined;

export const passwordService = {
  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  },

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  },

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  },

  /**
   * Burns the same CPU as a real verification. Called when the email is unknown so that
   * response timing doesn't reveal which accounts exist.
   */
  async verifyDummy(password: string): Promise<void> {
    dummyHash ??= argon2.hash('lekho-dummy-password-for-timing', ARGON2_OPTIONS);
    await this.verify(await dummyHash, password);
  },
};
