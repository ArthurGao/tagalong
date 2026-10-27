import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// One throwaway Postgres per e2e run, migrated exactly like production (`migrate deploy`).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Durability off: the suite truncates before every test and the data is thrown away.
  const container = await new PostgreSqlContainer('postgres:16')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .start();
  const databaseUrl = container.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
