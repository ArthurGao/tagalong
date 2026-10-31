import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { AppError } from '../../common/errors/app-error.js';
import { maskEmail, maskName, maskPhone } from '../../common/mask.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService, toMerchant } from '../notifications/notifications.service.js';
import { anonymizeBuyer } from '../orders/anonymize.js';
import { lockOrder } from '../orders/order-ops.js';
import { RefundProcessor } from '../orders/refund-processor.js';
import { decideRefund, refundableNow, refundStateByOrder } from '../orders/refunds.js';
import type { AdminOrderDto, AdminOrderPageDto, AdminOrderPiiDto, AdminOrderRowDto, AdminOrdersQueryDto, AnonymizeResultDto } from './admin.dto.js';
import { type AdminActor, recordAudit } from './audit.js';
import { merchantRef, PAGE, page } from './paging.js';

const rowInclude = {
  listing: { select: { id: true, shortCode: true, title: true } },
  merchant: merchantRef,
  disputes: { where: { open: true }, select: { id: true }, take: 1 },
} satisfies Prisma.OrderInclude;
const detailInclude = {
  ...rowInclude,
  items: { select: { quantity: true, unitPriceCents: true, option: { select: { name: true } } } },
  pickupPoint: { select: { label: true } },
  refunds: { orderBy: { createdAt: 'desc' }, select: { id: true, amountCents: true, status: true, reason: true, createdAt: true } },
} satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof rowInclude }>;

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundProcessor,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /admin/orders?q= (DESIGN §9): by order code, buyer email or phone, newest first; buyer PII masked. */
  async list(query: AdminOrdersQueryDto): Promise<AdminOrderPageDto> {
    const q = query.q?.trim();
    const after = query.cursor
      ? Prisma.sql`AND (created_at, id) < (SELECT created_at, id FROM "order" WHERE id = ${query.cursor}::uuid)`
      : Prisma.empty;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "order" WHERE ${q ? searchCondition(q) : Prisma.sql`true`} ${after}
      ORDER BY created_at DESC, id DESC LIMIT ${PAGE + 1}`;
    const rows = await this.prisma.order.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: rowInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return page(await this.toRows(ids.map((r) => byId.get(r.id)!)));
  }

  /** GET /admin/orders/:id: the row plus items, refunds and pickup point; PII still masked. */
  async get(id: string): Promise<AdminOrderDto> {
    const o = await this.prisma.order.findUnique({ where: { id }, include: detailInclude });
    if (!o) throw new AppError('NOT_FOUND', 'Order not found');
    const [row] = await this.toRows([o]);
    return {
      ...row,
      items: o.items.map((i) => ({ name: i.option.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      refunds: o.refunds,
      pickupPointLabel: o.pickupPoint?.label ?? null,
    };
  }

  /** POST /admin/orders/:id/reveal-pii: the buyer's details in full; the reveal is audited (PII_REVEAL) with the read. */
  async revealPii(actor: AdminActor, id: string, reason: string): Promise<AdminOrderPiiDto> {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.order.findUnique({
        where: { id },
        select: {
          buyerName: true,
          buyerEmail: true,
          buyerPhone: true,
          buyerNote: true,
          formAnswers: true,
          items: { select: { attendeeName: true, attendeeAnswers: true, option: { select: { name: true } } } },
        },
      });
      if (!o) throw new AppError('NOT_FOUND', 'Order not found');
      await recordAudit(tx, actor, { action: 'PII_REVEAL', targetType: 'order', targetId: id, reason });
      return {
        buyerName: o.buyerName,
        buyerEmail: o.buyerEmail,
        buyerPhone: o.buyerPhone,
        buyerNote: o.buyerNote,
        formAnswers: o.formAnswers as Record<string, unknown>,
        items: o.items.map((i) => ({
          optionName: i.option.name,
          attendeeName: i.attendeeName,
          attendeeAnswers: (i.attendeeAnswers ?? []) as Record<string, unknown>[],
        })),
      };
    });
  }

  /**
   * POST /admin/orders/:id/refund: a refund on the merchant's behalf (DESIGN §9), any merchant's order. The same
   * decision and queue as a merchant refund (direct charge: the money goes back from the merchant's account), plus the
   * audit row (REFUND_CREATE) and an email telling the merchant, all in the decision's transaction.
   */
  async refund(actor: AdminActor, id: string, amountCents: number, reason: string): Promise<AdminOrderDto> {
    const task = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id });
      if (!order) throw new AppError('NOT_FOUND', 'Order not found');
      const task = await decideRefund(tx, order, amountCents, reason);
      await recordAudit(tx, actor, { action: 'REFUND_CREATE', targetType: 'order', targetId: id, reason, metadata: { amountCents, refundId: task.id } });
      await this.notifications.enqueue(tx, {
        type: 'MERCHANT_REFUNDED_BY_ADMIN',
        ...toMerchant(order.merchant),
        payload: { publicCode: order.publicCode, listingTitle: order.listing.title, amountCents, reason },
        dedupeKey: `MERCHANT_REFUNDED_BY_ADMIN:${task.id}`,
      });
      return task;
    });
    await this.refunds.process(task);
    return this.get(id);
  }

  /**
   * POST /admin/buyers/anonymize: a privacy deletion request (DESIGN §9). The audit row keeps a hash of the address,
   * never the address, so the log itself holds no PII but a repeated request can still be matched.
   */
  async anonymize(actor: AdminActor, email: string, reason: string): Promise<AnonymizeResultDto> {
    const address = normalizeEmail(email);
    return this.prisma.$transaction(async (tx) => {
      const orders = await anonymizeBuyer(tx, address);
      await recordAudit(tx, actor, {
        action: 'BUYER_ANONYMIZE',
        targetType: 'buyer',
        targetId: emailHash(address),
        reason,
        metadata: { orderCount: orders.length, orderIds: orders.map((o) => o.id) },
      });
      return { orderCount: orders.length, publicCodes: orders.map((o) => o.publicCode) };
    });
  }

  private async toRows(orders: Row[]): Promise<AdminOrderRowDto[]> {
    const refunds = await refundStateByOrder(this.prisma, orders.map((o) => o.id));
    return orders.map((o) => {
      const pending = refunds.pending.get(o.id) ?? 0;
      return {
        id: o.id,
        publicCode: o.publicCode,
        status: o.status,
        isFree: o.isFree,
        buyerName: maskName(o.buyerName),
        buyerEmail: maskEmail(o.buyerEmail),
        buyerPhone: maskPhone(o.buyerPhone),
        anonymized: o.anonymizedAt !== null,
        totalCents: o.totalCents,
        refundedCents: o.refundedCents,
        pendingRefundCents: pending,
        refundableCents: refundableNow(o, pending),
        lastRefundFailed: refunds.lastFailed.has(o.id),
        openDispute: o.disputes.length > 0,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        listing: o.listing,
        merchant: o.merchant,
      };
    });
  }
}

/**
 * What `q` matches: an order code (with or without "TA-"), an email (exact, any case), or a phone number. Phones match
 * on their digits without the trunk 0 or the +64 country code, so "021 555 0199" finds "+64 21 555 0199" and back.
 */
function searchCondition(q: string): Prisma.Sql {
  if (q.includes('@')) return Prisma.sql`lower(buyer_email) = lower(${q})`;
  const code = q.toUpperCase();
  const byCode = Prisma.sql`public_code IN (${code}, ${`TA-${code}`})`;
  const national = q.replace(/\D/g, '').replace(/^(?:64|0)/, '');
  if (!/^[\d\s()+-]+$/.test(q) || national.length < 6) return byCode;
  return Prisma.sql`(${byCode} OR regexp_replace(buyer_phone, '\\D', '', 'g') LIKE ${`%${national}%`})`;
}

/** The audit log's handle on an erased address: SHA-256 of the normalised email, hex. */
export function emailHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}
