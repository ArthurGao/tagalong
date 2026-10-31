import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CancellationService } from '../orders/cancellation.service.js';
import type { AdminCancellationPageDto, AdminCancellationRowDto, AdminCancellationsQueryDto } from './admin.dto.js';
import { type AdminActor, recordAudit } from './audit.js';
import { merchantRef, PAGE, page } from './paging.js';

const include = {
  listing: { select: { id: true, shortCode: true, title: true, merchant: merchantRef } },
  tasks: { where: { status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, include: { order: { select: { publicCode: true } } } },
} satisfies Prisma.ListingCancellationInclude;
type Cancellation = Prisma.ListingCancellationGetPayload<{ include: typeof include }>;

@Injectable()
export class AdminCancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellations: CancellationService,
  ) {}

  /** GET /admin/cancellations?status= (DESIGN §9): bulk refunds, newest first, each with its FAILED refunds to retry. */
  async list(query: AdminCancellationsQueryDto): Promise<AdminCancellationPageDto> {
    const rows = await this.prisma.listingCancellation.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      include,
    });
    return page(await this.toRows(rows));
  }

  /**
   * POST /admin/refund-tasks/:id/retry: one FAILED refund of a cancellation back in the queue (`retryFailed`), audited
   * (REFUND_RETRY) in the same transaction. Single refunds (cancellationId null) are the merchant's to make again.
   */
  async retry(actor: AdminActor, taskId: string, reason: string): Promise<AdminCancellationRowDto> {
    const task = await this.prisma.refundTask.findUnique({ where: { id: taskId }, select: { cancellationId: true } });
    if (!task?.cancellationId) throw new AppError('NOT_FOUND', 'No refund of a cancellation with this id');
    const retried = await this.cancellations.retryFailed(task.cancellationId, {
      taskId,
      onRetried: (tx, [t]) =>
        recordAudit(tx, actor, { action: 'REFUND_RETRY', targetType: 'refund_task', targetId: taskId, reason, metadata: { orderId: t.orderId, amountCents: t.amountCents } }),
    });
    if (!retried) throw new AppError('INVALID_STATE_TRANSITION', 'Only a FAILED refund can be retried', { to: 'PENDING' });
    const [row] = await this.toRows([await this.prisma.listingCancellation.findUniqueOrThrow({ where: { id: task.cancellationId }, include })]);
    return row;
  }

  private async toRows(cancellations: Cancellation[]): Promise<AdminCancellationRowDto[]> {
    const pending = await this.cancellations.pendingByListing(cancellations.map((c) => c.listingId));
    return cancellations.map((c) => {
      const { merchant, ...listing } = c.listing;
      return {
        id: c.id,
        status: c.status,
        totalOrders: c.totalOrders,
        succeeded: c.succeeded,
        failed: c.failed,
        pending: pending.get(c.listingId) ?? 0,
        finishedAt: c.finishedAt,
        reason: c.reason,
        refundAll: c.refundAll,
        createdAt: c.createdAt,
        listing,
        merchant,
        failedRefunds: c.tasks.map((t) => ({
          id: t.id,
          orderId: t.orderId,
          orderPublicCode: t.order.publicCode,
          amountCents: t.amountCents,
          attempts: t.attempts,
          lastError: t.lastError,
          refused: t.stripeRefundId !== null,
          updatedAt: t.updatedAt,
        })),
      };
    });
  }
}
