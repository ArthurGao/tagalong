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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const required = {
      CLERK_SECRET_KEY: env.CLERK_SECRET_KEY,
      CLERK_JWT_KEY: env.CLERK_JWT_KEY,
      CLERK_AUTHORIZED_PARTIES: env.CLERK_AUTHORIZED_PARTIES.join(','),
      CLERK_WEBHOOK_SIGNING_SECRET: env.CLERK_WEBHOOK_SIGNING_SECRET,
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET_CONNECT: env.STRIPE_WEBHOOK_SECRET_CONNECT,
      STRIPE_WEBHOOK_SECRET_PLATFORM: env.STRIPE_WEBHOOK_SECRET_PLATFORM,
    };
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
