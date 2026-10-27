import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

export interface Notification {
  type: string;
  recipient: string;
  locale: string;
  payload: Prisma.InputJsonValue;
  /** e.g. `ORDER_CONFIRMED:{orderId}`: a replayed webhook never queues a second email. */
  dedupeKey: string;
}

// DESIGN §12 / D16: business code enqueues inside its own transaction; only outbox.job sends.
@Injectable()
export class NotificationsService {
  async enqueue(tx: Prisma.TransactionClient, ...notifications: Notification[]): Promise<void> {
    if (notifications.length) await tx.notificationOutbox.createMany({ data: notifications, skipDuplicates: true });
  }
}
