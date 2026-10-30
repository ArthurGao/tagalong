import type { Prisma } from '../../generated/prisma/client.js';

/** Rows per admin list page; lists fetch one more to know whether a next page exists. */
export const PAGE = 50;

/** The first PAGE rows and, when there were more, where the next page starts. */
export function page<T extends { id: string }>(rows: T[]): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, PAGE);
  return { items, nextCursor: rows.length > PAGE ? items[items.length - 1].id : null };
}

/** The merchant as admin rows reference it. */
export const merchantRef = { select: { id: true, slug: true, displayName: true, status: true } } satisfies Prisma.MerchantDefaultArgs;
