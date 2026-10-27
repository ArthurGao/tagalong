import { Prisma } from '../generated/prisma/client.js';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export const isRecordNotFound = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

export const isForeignKeyViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';

/**
 * Deadlock or serialization failure: the whole transaction can simply run again. Prisma reports these as P2034 from
 * its own queries, but raw queries (`$queryRaw`) surface the Postgres SQLSTATE only inside the message or meta, so
 * those are matched too.
 */
export const isRetryableTransactionError = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  (e.code === 'P2034' || /40P01|40001|deadlock detected/i.test(`${e.message} ${JSON.stringify(e.meta ?? {})}`));
