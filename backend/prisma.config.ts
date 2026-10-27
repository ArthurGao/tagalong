import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env itself; load it when present (CI passes real env vars).
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no database, so a missing URL only fails the commands that connect.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
