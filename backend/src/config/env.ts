import { z } from 'zod';

// Only the variables M0 needs; later milestones extend this schema (full list in backend/CLAUDE.md).
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3810),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),
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
