import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(5050),
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

    // --- SMS (guardian OTP) ---
    /** `console` prints messages (development only); `twilio` sends through Twilio's REST API. */
    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    /** Sender number (E.164) or Messaging Service SID (MG…). */
    TWILIO_FROM: z.string().optional(),
    /** Country calling code assumed for local numbers without one, e.g. 91 for India. */
    DEFAULT_PHONE_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default('91'),

    // --- Guardian mobile OTP (Student FRD §4.3) ---
    /** Pepper for OTP hashes (HMAC-SHA256). Required in production. */
    OTP_SECRET: z.string().min(32).optional(),
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(600).default(45),
    /** OTPs one school may send to one mobile number in 24 hours. */
    OTP_MAX_REQUESTS_PER_DAY: z.coerce.number().int().min(1).max(100).default(10),

    // --- ImageKit (student photographs) ---
    IMAGEKIT_PUBLIC_KEY: z.string().optional(),
    IMAGEKIT_PRIVATE_KEY: z.string().optional(),
    /** e.g. https://ik.imagekit.io/your_id */
    IMAGEKIT_URL_ENDPOINT: z.url().optional(),
    /** Root folder; photos go to <root>/<organizationId>/students/<studentId>. */
    IMAGEKIT_ROOT_FOLDER: z.string().regex(/^\/[A-Za-z0-9_\-/]*$/).default('/lekho'),
    /** Lifetime of signed photo URLs. */
    IMAGEKIT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    /** What happens to a replaced or removed photo: `delete` it from ImageKit, or `retain` it. */
    STUDENT_PHOTO_RETENTION: z.enum(['delete', 'retain']).default('delete'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.SMS_PROVIDER === 'twilio' && !(cfg.TWILIO_ACCOUNT_SID && cfg.TWILIO_AUTH_TOKEN && cfg.TWILIO_FROM)) {
      ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required for SMS_PROVIDER=twilio' });
    }
    const ik = [cfg.IMAGEKIT_PUBLIC_KEY, cfg.IMAGEKIT_PRIVATE_KEY, cfg.IMAGEKIT_URL_ENDPOINT].filter(Boolean).length;
    if (ik !== 0 && ik !== 3) ctx.addIssue({ code: 'custom', path: ['IMAGEKIT_PRIVATE_KEY'], message: 'Set all of IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT, or none' });
    if (cfg.NODE_ENV !== 'production') return;
    if (!cfg.JWT_PRIVATE_KEY) ctx.addIssue({ code: 'custom', path: ['JWT_PRIVATE_KEY'], message: 'Required in production' });
    if (!cfg.SMTP_URL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'Required in production' });
    if (!cfg.OTP_SECRET) ctx.addIssue({ code: 'custom', path: ['OTP_SECRET'], message: 'Required in production' });
    if (cfg.SMS_PROVIDER === 'console') ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console cannot be used in production' });
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
