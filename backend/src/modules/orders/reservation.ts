import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { assertOrderable, availabilityOf } from '../listings/availability.js';

export interface ItemQty {
  optionId: string;
  quantity: number;
}

const total = (items: ItemQty[]) => items.reduce((sum, i) => sum + i.quantity, 0);
// Lock order everywhere: order row → listing row → options by id. ListingsService.mutate() also takes the listing
// before its options, so ordering, payments, expiry and merchant edits never wait on each other in a cycle.
const sorted = (items: ItemQty[]) => [...items].sort((a, b) => a.optionId.localeCompare(b.optionId));
const soldOut = () => new AppError('SOLD_OUT', 'Not enough places left');
const isSoldOut = (e: unknown) => e instanceof AppError && e.code === 'SOLD_OUT';

/**
 * DESIGN §7: hold stock for an unpaid order. The listing row is locked first (merchant row shared), so whether the
 * listing still takes orders is decided by the same rules as the public page (`availabilityOf`) on rows nobody can
 * change meanwhile: a close or suspension during the request cannot slip through. The counters then move with
 * conditional UPDATEs, never read-then-write (root CLAUDE.md rule 4); any refusal throws and rolls back the caller's
 * transaction, and the CHECK constraints on listing and listing_option are the last line of defence.
 */
export async function reserve(tx: Prisma.TransactionClient, listingId: string, items: ItemQty[], now = new Date()): Promise<void> {
  await tx.$queryRaw`
    SELECT l.id FROM listing l JOIN merchant m ON m.id = l.merchant_id
    WHERE l.id = ${listingId}::uuid
    FOR UPDATE OF l FOR SHARE OF m`;
  const listing = await tx.listing.findUniqueOrThrow({
    where: { id: listingId },
    include: { options: true, merchant: { select: { status: true } } },
  });
  assertOrderable(availabilityOf(listing, now));
  const sum = total(items);
  const rows = await tx.$queryRaw<unknown[]>`
    UPDATE listing SET reserved_count = reserved_count + ${sum}, updated_at = now()
    WHERE id = ${listingId}::uuid AND (total_capacity IS NULL OR sold_count + reserved_count + ${sum} <= total_capacity)
    RETURNING id`;
  if (!rows.length) throw soldOut();
  for (const i of sorted(items)) {
    const updated = await tx.$queryRaw<unknown[]>`
      UPDATE listing_option SET reserved_count = reserved_count + ${i.quantity}, updated_at = now()
      WHERE id = ${i.optionId}::uuid AND listing_id = ${listingId}::uuid AND active
        AND (capacity IS NULL OR sold_count + reserved_count + ${i.quantity} <= capacity)
      RETURNING id`;
    if (!updated.length) throw soldOut();
  }
}

/** Gives held stock back when an unpaid order expires or is cancelled (DESIGN §6). */
export async function release(tx: Prisma.TransactionClient, listingId: string, items: ItemQty[]): Promise<void> {
  await tx.$executeRaw`
    UPDATE listing SET reserved_count = reserved_count - ${total(items)}, updated_at = now()
    WHERE id = ${listingId}::uuid`;
  for (const i of sorted(items)) {
    await tx.$executeRaw`
      UPDATE listing_option SET reserved_count = reserved_count - ${i.quantity}, updated_at = now()
      WHERE id = ${i.optionId}::uuid`;
  }
}

/**
 * Moves places to sold and returns the order's sign-up number (DESIGN §6, "→ PAID").
 * `held`: the places were reserved for this order. Otherwise they are taken afresh under the capacity conditions.
 */
async function moveToSold(tx: Prisma.TransactionClient, listingId: string, items: ItemQty[], held: boolean): Promise<number> {
  const sum = total(items);
  const [row] = await tx.$queryRaw<{ paid_seq: number }[]>`
    UPDATE listing
    SET sold_count = sold_count + ${sum}, reserved_count = reserved_count - ${held ? sum : 0},
        paid_seq = paid_seq + 1, updated_at = now()
    WHERE id = ${listingId}::uuid
      AND (${held}::boolean OR total_capacity IS NULL OR sold_count + reserved_count + ${sum} <= total_capacity)
    RETURNING paid_seq`;
  if (!row) throw soldOut();
  for (const i of sorted(items)) {
    const rows = await tx.$queryRaw<unknown[]>`
      UPDATE listing_option
      SET sold_count = sold_count + ${i.quantity}, reserved_count = reserved_count - ${held ? i.quantity : 0}, updated_at = now()
      WHERE id = ${i.optionId}::uuid
        AND (${held}::boolean OR capacity IS NULL OR sold_count + reserved_count + ${i.quantity} <= capacity)
      RETURNING id`;
    if (!rows.length) throw soldOut();
  }
  return row.paid_seq;
}

/** The usual payment: the order's held places become sold. */
export function sell(tx: Prisma.TransactionClient, listingId: string, items: ItemQty[]): Promise<number> {
  return moveToSold(tx, listingId, items, true);
}

/**
 * A payment after the order expired (§7.5): take the places again if they are still free. Returns the sign-up number,
 * or null when sold out; the savepoint undoes any partial update so the caller's transaction can go on to refund.
 */
export async function sellAfresh(tx: Prisma.TransactionClient, listingId: string, items: ItemQty[]): Promise<number | null> {
  await tx.$executeRaw`SAVEPOINT sell_afresh`;
  try {
    const seq = await moveToSold(tx, listingId, items, false);
    await tx.$executeRaw`RELEASE SAVEPOINT sell_afresh`;
    return seq;
  } catch (e) {
    if (!isSoldOut(e)) throw e;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT sell_afresh`;
    return null;
  }
}
