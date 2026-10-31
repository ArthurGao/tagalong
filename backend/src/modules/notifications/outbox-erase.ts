import { ANONYMIZED_EMAIL_DOMAIN } from '../../common/email.js';
import { Prisma } from '../../generated/prisma/client.js';

/** The recipient left on an erased outbox row. */
export const ERASED_RECIPIENT = `erased@${ANONYMIZED_EMAIL_DOMAIN}`;

/**
 * Erases the outbox rows `where` selects (DESIGN §10): only the type and times stay. Recipient, payload and delivery
 * error (a provider's error can quote the address) go, and the dedupe key (find-my-orders keys hold the address) becomes
 * `ERASED:{id}`; a queued row ends FAILED and is never sent. Already erased rows are left alone. Returns how many.
 */
export function eraseOutbox(tx: Prisma.TransactionClient, where: Prisma.Sql): Promise<number> {
  return tx.$executeRaw`
    UPDATE notification_outbox SET recipient = ${ERASED_RECIPIENT}, payload = '{}', last_error = NULL,
      status = CASE WHEN status = 'PENDING' THEN 'FAILED'::"NotificationStatus" ELSE status END,
      dedupe_key = 'ERASED:' || id::text
    WHERE dedupe_key NOT LIKE 'ERASED:%' AND (${where})`;
}
