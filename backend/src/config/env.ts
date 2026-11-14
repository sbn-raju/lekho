import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    CORS_ORIGIN: z.string().default('*'),
    /** Express "trust proxy" setting; needed behind a load balancer so client IPs (rate limits, audit) are real. */
    TRUST_PROXY: z.string().default('false'),

    /** Public URL of the web app; used to build verification / reset links in emails. */
    APP_URL: z.url().default('http://localhost:5173'),

    // --- Access tokens (JWT RS256) ---
    JWT_ISSUER: z.string().default('https://auth.lekho.com'),
    JWT_AUDIENCE: z.string().default('lekho-api'),
    /** PKCS#8 PEM RSA private key. Literal "\n" sequences are accepted. Required in production. */
    JWT_PRIVATE_KEY: z.string().optional(),
    /** Key ID placed in the JWT header. Defaults to the key's RFC 7638 thumbprint. */
    JWT_KEY_ID: z.string().optional(),
    /**
     * Retired public keys that must still verify tokens during rotation, as JSON:
     * [{"kid":"old-key","publicKey":"-----BEGIN PUBLIC KEY-----\n..."}]
     */
    JWT_PREVIOUS_PUBLIC_KEYS: z.string().optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),

    // --- Refresh tokens / sessions ---
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Window in which a just-rotated refresh token is tolerated (concurrent tabs refreshing at once). */
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
    /** Defaults to true in production. Set explicitly to false only for local http development. */
    COOKIE_SECURE: booleanString.optional(),

    // --- Account security ---
    MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).default(5),
    ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

    // --- Email ---
    /** e.g. smtps://user:pass@smtp.example.com:465. Required in production. */
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Lekho <no-reply@lekho.com>'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    if (!cfg.JWT_PRIVATE_KEY) ctx.addIssue({ code: 'custom', path: ['JWT_PRIVATE_KEY'], message: 'Required in production' });
    if (!cfg.SMTP_URL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'Required in production' });
    if (cfg.COOKIE_SECURE === false)
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Cannot be disabled in production' });
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const cookieSecure = env.COOKIE_SECURE ?? isProduction;

/** Parses TRUST_PROXY into what Express expects (boolean, hop count, or a list of subnets). */
export function trustProxySetting(): boolean | number | string {
  const v = env.TRUST_PROXY.trim();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
