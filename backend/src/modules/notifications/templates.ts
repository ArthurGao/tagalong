import { formatCents as money } from '../../common/money.js';
import { formatNzDateTime as nzTime } from '../../common/time.js';
import type { EmailAttachment, OutgoingEmail } from './email.service.js';
import { type CalendarEvent, icsCalendar, icsFilename } from './ics.js';

// Bilingual emails in one shared layout (DESIGN §12). Hand-written rather than React Email / MJML: the backend has no
// JSX build, the emails are short, and escaping stays in one place. Payloads carry everything needed to render:
// nothing is read from the database at send time.

// Type aliases (not interfaces) so they are assignable to Prisma JSON.
export type OrderConfirmedPayload = {
  publicCode: string;
  listingTitle: string;
  seq: number;
  items: { name: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  orderUrl: string;
  pickup: { label: string; address: string } | null;
  /** Shown on confirmations and receipts (DESIGN §12); absent on rows queued before M7. */
  merchant?: MerchantLine;
  events?: CalendarEvent[];
};
export type OrderAutoRefundedPayload = {
  publicCode: string;
  listingTitle: string;
  totalCents: number;
  listingUrl: string;
};
export type RegistrationConfirmedPayload = {
  publicCode: string;
  listingTitle: string;
  seq: number;
  items: { name: string; quantity: number }[];
  orderUrl: string;
  pickup: { label: string; address: string } | null;
  canSelfCancel: boolean;
  /** ISO time, or null when cancelling is open until the event (or not allowed). */
  selfCancelUntil: string | null;
  merchant?: MerchantLine;
  events?: CalendarEvent[];
};
export type RegistrationCancelledPayload = {
  listingTitle: string;
  reason: string;
  listingUrl: string;
};
export type OrderRefundedPayload = {
  publicCode: string;
  listingTitle: string;
  amountCents: number;
  refundedCents: number;
  totalCents: number;
  reason: string | null;
  orderUrl: string;
  merchant?: MerchantLine;
};
export type MerchantDisputePayload = {
  publicCode: string;
  listingTitle: string;
  amountCents: number;
  reason: string;
};
export type RefundFailedPayload = {
  publicCode: string;
  listingTitle: string;
  amountCents: number;
  error: string;
};
export type CancellationFinishedPayload = {
  listingTitle: string;
  succeeded: number;
  failed: number;
};
export type PickupPointChangedPayload = {
  label: string;
  address: string;
};
export type AdminSignInPayload = {
  adminEmail: string;
  sessionId: string;
  signedInAt: string;
};

export type ListingTakenDownPayload = { listingTitle: string; reason: string; refundAll: boolean };
export type MerchantSuspendedPayload = { merchantName: string; reason: string };
export type MerchantReinstatedPayload = { merchantName: string };
export type MerchantRefundedByAdminPayload = { publicCode: string; listingTitle: string; amountCents: number; reason: string };
export type MerchantLine = { name: string; gstNumber: string | null };
export type EventReminderPayload = {
  publicCode: string;
  listingTitle: string;
  orderUrl: string;
  /** The sessions still ahead, first one first. */
  events: CalendarEvent[];
};
export type OrderRecoveryPayload = {
  orders: { listingTitle: string; publicCode: string; createdAt: string; url: string }[];
};

export class UnknownTemplateError extends Error {}

/** What every email needs besides its payload. */
/** Every email type with the payload it renders from: producers are checked against it (notifications.service). */
export interface PayloadByType {
  ORDER_CONFIRMED: OrderConfirmedPayload;
  ORDER_AUTO_REFUNDED: OrderAutoRefundedPayload;
  REGISTRATION_CONFIRMED: RegistrationConfirmedPayload;
  REGISTRATION_CANCELLED: RegistrationCancelledPayload;
  ORDER_REFUNDED: OrderRefundedPayload;
  EVENT_REMINDER: EventReminderPayload;
  ORDER_RECOVERY: OrderRecoveryPayload;
  MERCHANT_DISPUTE: MerchantDisputePayload;
  REFUND_FAILED: RefundFailedPayload;
  CANCELLATION_FINISHED: CancellationFinishedPayload;
  PICKUP_POINT_CHANGED: PickupPointChangedPayload;
  ADMIN_SIGN_IN: AdminSignInPayload;
  LISTING_TAKEN_DOWN: ListingTakenDownPayload;
  MERCHANT_SUSPENDED: MerchantSuspendedPayload;
  MERCHANT_REINSTATED: MerchantReinstatedPayload;
  MERCHANT_REFUNDED_BY_ADMIN: MerchantRefundedByAdminPayload;
}

export interface RenderContext {
  appUrl: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Plain lines → a text body, and an HTML body in the shared layout with every line escaped (merchant and buyer text is
 * untrusted). Buyer emails end with the find-my-orders footer.
 */
function email(
  to: string,
  subject: string,
  lines: string[],
  link: { label: string; url: string } | undefined,
  footer: string[] | null,
  attachments?: EmailAttachment[],
): OutgoingEmail {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.url}`] : []), ...(footer ? ['', '—', ...footer] : [])].join('\n');
  const body = [
    ...lines.map((l) => (l ? `<p style="margin:0 0 12px">${escapeHtml(l)}</p>` : '')),
    link
      ? `<p style="margin:20px 0"><a href="${escapeHtml(link.url)}" style="background:#1f2937;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p>`
      : '',
  ].join('\n');
  const foot = footer ? footer.map((l) => `<p style="margin:0 0 6px">${linkify(l)}</p>`).join('\n') : '';
  const html = `<div style="font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;font-size:15px;line-height:1.5">
<p style="margin:0 0 20px;font-weight:700;font-size:18px">TagAlong</p>
${body}
${foot ? `<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px">\n${foot}\n</div>` : ''}
</div>`;
  return { to, subject, text, html, ...(attachments?.length && { attachments }) };
}

/** Escapes a footer line and turns its one URL into a link. */
function linkify(line: string): string {
  return escapeHtml(line).replace(/https?:\/\/\S+/, (url) => `<a href="${url}" style="color:#6b7280">${url}</a>`);
}


/** "商家：X · GST 123-456-789" (DESIGN §12: the platform issues no tax invoices; the merchant's GST number is shown). */
function merchantLine(zh: boolean, m: MerchantLine | undefined): string[] {
  if (!m) return [];
  const gst = m.gstNumber ? ` · GST ${m.gstNumber}` : '';
  return [zh ? `商家：${m.name}${gst}` : `Sold by ${m.name}${gst}`];
}

export function renderEmail(type: string, locale: string, to: string, payload: unknown, ctx: RenderContext): OutgoingEmail {
  const zh = locale !== 'en';
  type Link = { label: string; url: string };
  const footer = zh
    ? ['你收到这封邮件，是因为你在 TagAlong 下单或报名。', `找回你的所有订单：${ctx.appUrl}/${locale}/find-order`]
    : ['You received this because you ordered or registered on TagAlong.', `Find all your orders: ${ctx.appUrl}/${locale}/find-order`];
  /** To a buyer: the find-my-orders footer, and an order's sessions as an attached .ics (with a line saying so). */
  const toBuyer = (subject: string, lines: string[], link?: Link, calendar?: { publicCode: string; events?: CalendarEvent[] }) => {
    if (!calendar?.events?.length) return email(to, subject, lines, link, footer);
    const ics: EmailAttachment = { filename: icsFilename(calendar.publicCode), content: icsCalendar(calendar.events), contentType: 'text/calendar; charset=utf-8' };
    const note = zh ? '附件是日历文件，可以加入你的日历。' : 'The attached calendar file adds this to your calendar.';
    return email(to, subject, [...lines, note], link, footer, [ics]);
  };
  const refundEta = zh ? '退款通常在 5–10 个工作日内回到原支付方式。' : 'Refunds usually reach your card within 5–10 business days.';
  const reasonLine = (reason: string | null | undefined) => (reason ? [zh ? `原因：${reason}` : `Reason: ${reason}`] : []);
  const viewOrder = (url: string): Link => ({ label: zh ? '查看订单' : 'View your order', url });
  const viewListing = (url: string): Link => ({ label: zh ? '查看接龙' : 'View the listing', url });
  /** To a merchant or an admin: no buyer footer. */
  const toStaff = (subject: string, lines: string[]) => email(to, subject, lines, undefined, null);
  switch (type) {
    case 'ORDER_CONFIRMED': {
      const p = payload as OrderConfirmedPayload;
      const items = p.items.map((i) => `${i.name} ×${i.quantity}  ${money(i.unitPriceCents * i.quantity)}`);
      const pickup = p.pickup ? [zh ? `取货：${p.pickup.label}，${p.pickup.address}` : `Pickup: ${p.pickup.label}, ${p.pickup.address}`] : [];
      return toBuyer(
        zh ? `接龙成功 #${p.seq}：${p.listingTitle}` : `You're in (#${p.seq}): ${p.listingTitle}`,
        [
          zh ? `付款成功，你是第 ${p.seq} 位。订单号 ${p.publicCode}` : `Payment received. You are #${p.seq}. Order ${p.publicCode}`,
          ...items,
          zh ? `合计 ${money(p.totalCents)}（含 GST）` : `Total ${money(p.totalCents)} (incl. GST)`,
          ...merchantLine(zh, p.merchant),
          ...pickup,
        ],
        viewOrder(p.orderUrl),
        p,
      );
    }
    case 'ORDER_AUTO_REFUNDED': {
      const p = payload as OrderAutoRefundedPayload;
      return toBuyer(
        zh ? `已自动退款：${p.listingTitle}` : `Refunded: ${p.listingTitle}`,
        [
          zh
            ? `你的付款在预留时间结束后才到账，而名额已经被订完，所以我们已全额退款 ${money(p.totalCents)}。订单号 ${p.publicCode}`
            : `Your payment arrived after your reservation ended and the places had sold out, so we refunded ${money(p.totalCents)} in full. Order ${p.publicCode}`,
          refundEta,
        ],
        viewListing(p.listingUrl),
      );
    }
    case 'REGISTRATION_CONFIRMED': {
      const p = payload as RegistrationConfirmedPayload;
      const until = p.selfCancelUntil ? nzTime(p.selfCancelUntil, locale) : null;
      const cancelLine = !p.canSelfCancel
        ? []
        : [until ? (zh ? `如需取消，请在 ${until} 前通过下面的链接操作。` : `To cancel, use the link below before ${until}.`) : zh ? '如需取消，可通过下面的链接操作。' : 'To cancel, use the link below.'];
      return toBuyer(
        zh ? `报名成功 #${p.seq}：${p.listingTitle}` : `You're registered (#${p.seq}): ${p.listingTitle}`,
        [
          zh ? `报名成功，你是第 ${p.seq} 位。报名号 ${p.publicCode}` : `You're registered as #${p.seq}. Reference ${p.publicCode}`,
          ...p.items.map((i) => `${i.name} ×${i.quantity}`),
          ...(p.pickup ? [zh ? `地点：${p.pickup.label}，${p.pickup.address}` : `Place: ${p.pickup.label}, ${p.pickup.address}`] : []),
          ...cancelLine,
          ...merchantLine(zh, p.merchant),
        ],
        { label: zh ? '查看报名' : 'View your registration', url: p.orderUrl },
        p,
      );
    }
    case 'REGISTRATION_CANCELLED': {
      const p = payload as RegistrationCancelledPayload;
      return toBuyer(
        zh ? `报名已被取消：${p.listingTitle}` : `Registration cancelled: ${p.listingTitle}`,
        [
          zh ? `商家取消了你在「${p.listingTitle}」的报名。` : `The organiser cancelled your registration for "${p.listingTitle}".`,
          ...reasonLine(p.reason),
        ],
        viewListing(p.listingUrl),
      );
    }
    case 'ORDER_REFUNDED': {
      const p = payload as OrderRefundedPayload;
      const full = p.refundedCents >= p.totalCents;
      return toBuyer(
        zh ? `已退款 ${money(p.amountCents)}：${p.listingTitle}` : `Refund of ${money(p.amountCents)}: ${p.listingTitle}`,
        [
          zh ? `商家已为订单 ${p.publicCode} 退款 ${money(p.amountCents)}${full ? '（全额）' : ''}。` : `The seller refunded ${money(p.amountCents)}${full ? ' (in full)' : ''} for order ${p.publicCode}.`,
          ...reasonLine(p.reason),
          refundEta,
          ...merchantLine(zh, p.merchant),
        ],
        viewOrder(p.orderUrl),
      );
    }
    case 'EVENT_REMINDER': {
      const p = payload as EventReminderPayload;
      const [first] = p.events;
      const when = nzTime(first.startsAt, locale);
      return toBuyer(
        zh ? `活动提醒：${p.listingTitle}（${when}）` : `Reminder: ${p.listingTitle} (${when})`,
        [
          zh ? `提醒你：「${p.listingTitle}」将于 ${when}（新西兰时间）开始。` : `"${p.listingTitle}" starts at ${when} (New Zealand time).`,
          ...(first.location ? [zh ? `地点：${first.location}` : `Where: ${first.location}`] : []),
          zh ? `订单号 ${p.publicCode}` : `Order ${p.publicCode}`,
        ],
        viewOrder(p.orderUrl),
        p,
      );
    }
    case 'ORDER_RECOVERY': {
      const p = payload as OrderRecoveryPayload;
      return toBuyer(zh ? '你在 TagAlong 的订单' : 'Your TagAlong orders', [
        zh ? '这是你最近 90 天在 TagAlong 的订单，点链接可以查看：' : 'Here are your TagAlong orders from the last 90 days:',
        ...p.orders.flatMap((o) => ['', `${o.listingTitle} · ${o.publicCode} · ${nzTime(o.createdAt, locale)}`, o.url]),
        '',
        zh ? '如果不是你本人申请的，可以忽略这封邮件。' : "If you didn't ask for this, you can ignore this email.",
      ]);
    }
    case 'MERCHANT_DISPUTE': {
      const p = payload as MerchantDisputePayload;
      return toStaff(zh ? `付款争议：订单 ${p.publicCode}` : `Payment dispute: order ${p.publicCode}`, [
        zh
          ? `买家对「${p.listingTitle}」的订单 ${p.publicCode}（${money(p.amountCents)}）提出了付款争议，原因：${p.reason}。请尽快在 Stripe Dashboard 提交证据。`
          : `A buyer disputed order ${p.publicCode} (${money(p.amountCents)}) for "${p.listingTitle}", reason: ${p.reason}. Submit evidence in your Stripe Dashboard soon.`,
      ]);
    }
    case 'REFUND_FAILED': {
      const p = payload as RefundFailedPayload;
      return toStaff(zh ? `退款失败：订单 ${p.publicCode}` : `Refund failed: order ${p.publicCode}`, [
        zh
          ? `「${p.listingTitle}」订单 ${p.publicCode} 的 ${money(p.amountCents)} 退款多次尝试仍未成功（${p.error}）。这笔钱没有退回，可以在订单列表重新退款，或在 Stripe Dashboard 处理。`
          : `The ${money(p.amountCents)} refund on order ${p.publicCode} for "${p.listingTitle}" failed after several tries (${p.error}). Nothing was refunded; refund again from your orders, or in your Stripe Dashboard.`,
      ]);
    }
    case 'CANCELLATION_FINISHED': {
      const p = payload as CancellationFinishedPayload;
      return toStaff(zh ? `接龙已取消：${p.listingTitle}` : `Listing cancelled: ${p.listingTitle}`, [
        zh ? `退款完成 ${p.succeeded} 笔，失败 ${p.failed} 笔。` : `${p.succeeded} refund(s) done, ${p.failed} failed.`,
        ...(p.failed ? [zh ? '失败的退款会由平台跟进处理。' : 'The platform will follow up on the failed refunds.'] : []),
      ]);
    }
    case 'PICKUP_POINT_CHANGED': {
      const p = payload as PickupPointChangedPayload;
      return toBuyer(zh ? '取货地点已变更' : 'Your pickup point changed', [
        zh ? `新的取货地点：${p.label}，${p.address}` : `New pickup point: ${p.label}, ${p.address}`,
      ]);
    }
    case 'LISTING_TAKEN_DOWN': {
      const p = payload as ListingTakenDownPayload;
      return toStaff(zh ? `接龙已被平台下架：${p.listingTitle}` : `Listing taken down: ${p.listingTitle}`, [
        zh ? `TagAlong 平台下架了你的接龙「${p.listingTitle}」，买家已无法下单。` : `TagAlong took down your listing "${p.listingTitle}"; buyers can no longer order.`,
        zh ? `原因：${p.reason}` : `Reason: ${p.reason}`,
        p.refundAll
          ? zh
            ? '已付款的订单会全额退款，报名会被取消，买家会收到通知。'
            : 'Paid orders are being refunded in full and registrations cancelled; buyers are told.'
          : zh
            ? '已有订单保持不变。如有疑问，请回复这封邮件联系平台。'
            : 'Existing orders are unchanged. Reply to this email if you have questions.',
      ]);
    }
    case 'MERCHANT_SUSPENDED': {
      const p = payload as MerchantSuspendedPayload;
      return toStaff(zh ? `你的 TagAlong 店铺已被暂停：${p.merchantName}` : `Your TagAlong shop is suspended: ${p.merchantName}`, [
        zh ? '平台暂停了你的店铺，所有接龙暂停销售，也不能发布新接龙。已有订单不受影响。' : 'The platform suspended your shop: every listing has stopped selling and new ones cannot be published. Existing orders are unaffected.',
        zh ? `原因：${p.reason}` : `Reason: ${p.reason}`,
        zh ? '如有疑问，请回复这封邮件联系平台。' : 'Reply to this email if you have questions.',
      ]);
    }
    case 'MERCHANT_REINSTATED': {
      const p = payload as MerchantReinstatedPayload;
      return toStaff(zh ? `你的 TagAlong 店铺已恢复：${p.merchantName}` : `Your TagAlong shop is active again: ${p.merchantName}`, [
        zh ? '平台已恢复你的店铺，进行中的接龙可以继续接受下单。' : 'The platform reinstated your shop; your open listings take orders again.',
      ]);
    }
    case 'MERCHANT_REFUNDED_BY_ADMIN': {
      const p = payload as MerchantRefundedByAdminPayload;
      return toStaff(zh ? `平台代你退款：订单 ${p.publicCode}` : `TagAlong refunded order ${p.publicCode} for you`, [
        zh
          ? `TagAlong 平台为「${p.listingTitle}」的订单 ${p.publicCode} 发起了 ${money(p.amountCents)} 的退款，退款从你的 Stripe 账户退回给买家。`
          : `TagAlong refunded ${money(p.amountCents)} on order ${p.publicCode} for "${p.listingTitle}"; the money goes back to the buyer from your Stripe account.`,
        zh ? `原因：${p.reason}` : `Reason: ${p.reason}`,
        zh ? '如有疑问，请回复这封邮件联系平台。' : 'Reply to this email if you have questions.',
      ]);
    }
    case 'ADMIN_SIGN_IN': {
      const p = payload as AdminSignInPayload;
      return toStaff('TagAlong admin sign-in', [`${p.adminEmail} signed in to the admin console at ${p.signedInAt} (session ${p.sessionId}).`]);
    }
    default:
      throw new UnknownTemplateError(`No email template for ${type}`);
  }
}
