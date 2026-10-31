import { z } from 'zod';

const list = (lowercase = false) =>
  z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
        .filter(Boolean),
    );

// Grows milestone by milestone; the full list is in backend/CLAUDE.md.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3810),
    // Which deployment this is (DESIGN §13): staging and production both run NODE_ENV=production.
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    // Error reporting (DESIGN §13); off without a DSN, so tests and local runs send nothing.
    SENTRY_DSN: z.string().default(''),
    // The deployed commit, set by Render; reported by /health and to Sentry as the release.
    RENDER_GIT_COMMIT: z.string().default(''),
    APP_URL: z.url(),
    DATABASE_URL: z.url(),
    // Clerk (DESIGN D13, §9). Optional outside production so the app boots before keys exist;
    // without CLERK_JWT_KEY every authenticated request is rejected with 401.
    CLERK_SECRET_KEY: z.string().default(''),
    CLERK_JWT_KEY: z.string().default(''),
    CLERK_AUTHORIZED_PARTIES: list(),
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().default(''),
    ADMIN_EMAIL_ALLOWLIST: list(true),
    // Stripe (DESIGN §8): same rule, optional outside production; test keys only outside production.
    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET_CONNECT: z.string().default(''),
    STRIPE_WEBHOOK_SECRET_PLATFORM: z.string().default(''),
    // Object storage (S3 or Cloudflare R2) for listing images; optional outside production.
    S3_ENDPOINT: z.string().default(''),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_PUBLIC_BASE_URL: z.string().default(''),
    // Orders (DESIGN §7, §8.2). Stripe Checkout sessions last at least 30 minutes.
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(300),
    PLATFORM_FEE_FIXED_CENTS: z.coerce.number().int().min(0).default(0),
    RESERVATION_MINUTES: z.coerce.number().int().min(30).max(1440).default(30),
    // Email (DESIGN §12): Mailpit over SMTP locally, Resend in production.
    EMAIL_PROVIDER: z.enum(['mailpit', 'resend']).default('mailpit'),
    EMAIL_FROM: z.string().default(''),
    RESEND_API_KEY: z.string().default(''),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1026),
    // Abuse controls on public order creation (DESIGN §10). Without a secret outside production, Cloudflare's
    // always-pass test secret is used (DESIGN §13 environments).
    TURNSTILE_SECRET_KEY: z.string().default(''),
    ORDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    // Express "trust proxy": which hops may set X-Forwarded-For (the Next rewrite runs on the same host locally).
    TRUST_PROXY: z.string().default('loopback'),
    // Shared with the web app: its proxy passes the buyer's IP with it (common/security/edge-client-ip.ts).
    EDGE_SECRET: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    // CLAUDE.md rule 9: live Stripe keys in production only, and only live keys there; secret or restricted keys only.
    const mode = env.APP_ENV === 'production' ? 'live' : 'test';
    if (env.STRIPE_SECRET_KEY && !new RegExp(`^(sk|rk)_${mode}_`).test(env.STRIPE_SECRET_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: `must be a ${mode} secret or restricted key` });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.APP_ENV === 'development') ctx.addIssue({ code: 'custom', path: ['APP_ENV'], message: 'must be staging or production' });
    const required = {
      CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
      CLERK_JWT_KEY: env.CLERK_JWT_KEY,
      CLERK_AUTHORIZED_PARTIES: env.CLERK_AUTHORIZED_PARTIES.join(','),
      CLERK_WEBHOOK_SIGNING_SECRET: env.CLERK_WEBHOOK_SIGNING_SECRET,
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET_CONNECT: env.STRIPE_WEBHOOK_SECRET_CONNECT,
      STRIPE_WEBHOOK_SECRET_PLATFORM: env.STRIPE_WEBHOOK_SECRET_PLATFORM,
      S3_BUCKET: env.S3_BUCKET,
      S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      S3_PUBLIC_BASE_URL: env.S3_PUBLIC_BASE_URL,
      EMAIL_FROM: env.EMAIL_FROM,
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
      RESEND_API_KEY: env.EMAIL_PROVIDER === 'resend' ? env.RESEND_API_KEY : 'not used',
      SENTRY_DSN: env.SENTRY_DSN,
      EDGE_SECRET: env.EDGE_SECRET,
    };
    if (env.EMAIL_PROVIDER !== 'resend') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'must be resend in production' });
    }
    for (const [key, value] of Object.entries(required)) {
      if (!value) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}
