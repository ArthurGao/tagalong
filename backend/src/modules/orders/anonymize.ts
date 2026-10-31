import { ANONYMIZED_EMAIL_DOMAIN, normalizeEmail } from '../../common/email.js';
import { AppError } from '../../common/errors/app-error.js';
import { accessToken } from '../../common/ids.js';
import { Prisma } from '../../generated/prisma/client.js';
import { eraseOutbox } from '../notifications/outbox-erase.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';

export const ANONYMIZED_NAME = 'Anonymized';

/**
 * Serialises work on one buyer address (transaction-scoped advisory lock on the normalised email): anonymisation, and
 * find-my-orders, which reads the address's orders and links before it queues its email. Without it, an email built
 * from orders read just before anonymisation could be queued just after it, to the old address with live links.
 */
export async function lockBuyerEmails(tx: Prisma.TransactionClient, emails: string[]): Promise<void> {
  // One order for every caller (normalised, sorted), so two transactions locking several addresses cannot deadlock.
  for (const email of [...new Set(emails.map(normalizeEmail))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buyer-email:${email}`}, 0))`;
  }
}

/**
 * Replaces the buyer's PII on these orders, which the caller has locked: name, email, phone, note and every answer
 * replaced, shown as anonymous, `anonymizedAt` set; amounts and status kept. A new token per order, never shown to
 * anyone: the old link stops working and no new one exists. Shared by the privacy request and the retention job.
 */
export async function anonymizeOrders(tx: Prisma.TransactionClient, ids: string[], now = new Date()): Promise<void> {
  const tokens = ids.map(() => accessToken());
  await tx.$executeRaw`
    UPDATE "order" o SET buyer_name = ${ANONYMIZED_NAME}, buyer_email = o.id::text || ${`@${ANONYMIZED_EMAIL_DOMAIN}`}, buyer_phone = '',
      buyer_note = NULL, form_answers = '{}', display_anonymous = true, access_token = v.token, anonymized_at = ${now}, updated_at = ${now}
    FROM unnest(${ids}::uuid[], ${tokens}::text[]) AS v(id, token)
    WHERE o.id = v.id`;
  await tx.$executeRaw`UPDATE order_item SET attendee_name = NULL, attendee_answers = '[]' WHERE order_id = ANY(${ids}::uuid[])`;
}

/**
 * A buyer's privacy deletion request (DESIGN §9), under locks on every order of the address (case-insensitive):
 * name, email, phone, note and every answer replaced, shown as anonymous, the order link's token replaced, amounts
 * and status kept. Emails to the address are erased from the outbox (queued ones are never sent) and pending
 * find-my-orders requests dropped. Refused while an order is awaiting payment or has an open dispute: those still need
 * to reach the buyer, or the evidence. Returns the orders it anonymized; none is NOT_FOUND.
 */
export async function anonymizeBuyer(tx: Prisma.TransactionClient, email: string, now = new Date()): Promise<{ id: string; publicCode: string }[]> {
  await lockBuyerEmails(tx, [email]);
  const orders = await tx.$queryRaw<{ id: string; public_code: string; status: OrderStatus }[]>`
    SELECT id, public_code, status FROM "order" WHERE lower(buyer_email) = lower(${email}) ORDER BY id FOR UPDATE`;
  if (!orders.length) throw new AppError('NOT_FOUND', 'No orders for this email');
  const ids = orders.map((o) => o.id);
  const disputed = new Set((await tx.dispute.findMany({ where: { orderId: { in: ids }, open: true }, select: { orderId: true } })).map((d) => d.orderId));
  const blocking = orders.filter((o) => o.status === 'PENDING_PAYMENT' || disputed.has(o.id)).map((o) => o.public_code);
  if (blocking.length) throw new AppError('ANONYMIZE_BLOCKED', 'Orders awaiting payment or under dispute', { publicCodes: blocking });

  await anonymizeOrders(tx, ids, now);
  await eraseOutbox(tx, Prisma.sql`lower(recipient) = lower(${email})`);
  await tx.orderRecoveryRequest.deleteMany({ where: { email: normalizeEmail(email) } }); // stored normalised
  return orders.map((o) => ({ id: o.id, publicCode: o.public_code }));
}
