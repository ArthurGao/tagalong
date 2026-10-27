import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads .env itself; load it when present (CI passes real env vars).
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
