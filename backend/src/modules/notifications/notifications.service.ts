import { Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PayloadByType } from './templates.js';

/** An email to queue: its payload must be the one its type renders from (templates.ts `PayloadByType`). */
export type Notification = {
  [T in keyof PayloadByType]: {
    type: T;
    recipient: string;
    locale: string;
    payload: PayloadByType[T];
    /** e.g. `ORDER_CONFIRMED:{orderId}`: a replayed webhook never queues a second email. */
    dedupeKey: string;
  };
}[keyof PayloadByType];

/** Recipient and language of an email to a merchant. Merchants have no language setting yet. */
export const toMerchant = (merchant: { contactEmail: string }) => ({ recipient: merchant.contactEmail, locale: DEFAULT_LOCALE });

// DESIGN §12 / D16: business code enqueues inside its own transaction; only outbox.job sends.
@Injectable()
export class NotificationsService {
  async enqueue(tx: Prisma.TransactionClient, ...notifications: Notification[]): Promise<void> {
    if (notifications.length) await tx.notificationOutbox.createMany({ data: notifications, skipDuplicates: true });
  }
}
