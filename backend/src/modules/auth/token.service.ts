import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { SignJWT, jwtVerify, exportJWK, calculateJwkThumbprint, errors as joseErrors, type JWK } from 'jose';
import { z } from 'zod';
import { env, isProduction } from '../../config/env.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/utils/logger.js';

const ALG = 'RS256';

interface KeyRing {
  signing: { kid: string; privateKey: KeyObject };
  /** kid → public key. Includes the current key plus any retired keys still inside their token lifetime. */
  verification: Map<string, KeyObject>;
}

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}

const previousKeysSchema = z.array(z.object({ kid: z.string().min(1), publicKey: z.string().min(1) }));

const pem = (value: string) => value.replace(/\\n/g, '\n');

async function loadKeyRing(): Promise<KeyRing> {
  let privateKey: KeyObject;
  if (env.JWT_PRIVATE_KEY) {
    privateKey = createPrivateKey(pem(env.JWT_PRIVATE_KEY));
    if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('JWT_PRIVATE_KEY must be an RSA key');
  } else {
    if (isProduction) throw new Error('JWT_PRIVATE_KEY is required in production');
    ({ privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
    logger.warn('JWT_PRIVATE_KEY not set: using an ephemeral signing key. Tokens will not survive a restart.');
  }

  const publicKey = createPublicKey(privateKey);
  const kid = env.JWT_KEY_ID ?? (await calculateJwkThumbprint(await exportJWK(publicKey)));

  const verification = new Map<string, KeyObject>([[kid, publicKey]]);
  if (env.JWT_PREVIOUS_PUBLIC_KEYS) {
    for (const k of previousKeysSchema.parse(JSON.parse(env.JWT_PREVIOUS_PUBLIC_KEYS))) {
      verification.set(k.kid, createPublicKey(pem(k.publicKey)));
    }
  }
  return { signing: { kid, privateKey }, verification };
}

let keyRing: Promise<KeyRing> | undefined;
const getKeyRing = () => (keyRing ??= loadKeyRing());

export const tokenService = {
  /** Loads keys eagerly so a misconfigured key fails at startup rather than on first login. */
  async init(): Promise<void> {
    await getKeyRing();
  },

  /** Minimal access token (FRD §4.4): identity + session only, no roles or permissions. */
  async signAccessToken({ userId, sessionId, tokenVersion }: AccessTokenClaims) {
    const { signing } = await getKeyRing();
    const expiresIn = env.ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await new SignJWT({ sid: sessionId, token_version: tokenVersion })
      .setProtectedHeader({ alg: ALG, kid: signing.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(signing.privateKey);
    return { accessToken, expiresIn };
  },

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { verification } = await getKeyRing();
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid ? verification.get(header.kid) : undefined;
          if (!key) throw new joseErrors.JWKSNoMatchingKey();
          return key;
        },
        { algorithms: [ALG], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
      );
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.token_version !== 'number') {
        throw ApiError.unauthenticated('Invalid access token');
      }
      return { userId: payload.sub, sessionId: payload.sid, tokenVersion: payload.token_version };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw new ApiError('TOKEN_EXPIRED', 'Access token has expired');
      throw ApiError.unauthenticated('Invalid access token');
    }
  },

  /** Public keys as a JWKS document, for services that verify Lekho tokens independently. */
  async jwks(): Promise<{ keys: JWK[] }> {
    const { verification } = await getKeyRing();
    const keys = await Promise.all(
      [...verification].map(async ([kid, key]) => ({ ...(await exportJWK(key)), kid, alg: ALG, use: 'sig' })),
    );
    return { keys };
  },
};
