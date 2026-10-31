import type { Prisma } from '../../generated/prisma/client.js';

/** The admin behind a write, and where it came from (DESIGN §9: every admin write is audited). */
export interface AdminActor {
  userId: string;
  ip: string | null;
}

/** What the admin console writes to the audit log (the log also holds ADMIN_SIGN_IN and role changes). */
export const ADMIN_ACTIONS = [
  'MERCHANT_SUSPEND',
  'MERCHANT_REINSTATE',
  'MERCHANT_NOTE',
  'LISTING_CLOSE',
  'LISTING_TAKEDOWN',
  'LISTING_RESTORE',
  'PII_REVEAL',
  'REFUND_CREATE',
  'REFUND_RETRY',
  'BUYER_ANONYMIZE',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** Writes the audit record inside the write's own transaction, so neither exists without the other. */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  entry: { action: AdminAction; targetType: 'merchant' | 'listing' | 'order' | 'refund_task' | 'buyer'; targetId: string; reason: string | null; metadata?: Prisma.InputJsonObject },
): Promise<void> {
  await tx.auditLog.create({
    data: { actorUserId: actor.userId, actorRole: 'ADMIN', ip: actor.ip, ...entry, metadata: entry.metadata ?? {} },
  });
}
