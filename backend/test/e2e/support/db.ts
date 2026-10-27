import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../src/generated/prisma/client.js';

export function testPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

let truncateAll: string | undefined;

// TRUNCATE does not fire row triggers, so it also clears the append-only audit_log.
export async function resetDb(prisma: PrismaClient): Promise<void> {
  if (!truncateAll) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    truncateAll = `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`;
  }
  await prisma.$executeRawUnsafe(truncateAll);
}
