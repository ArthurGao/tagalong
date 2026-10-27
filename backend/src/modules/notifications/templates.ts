import { formatCents as money } from '../../common/money.js';
import { formatNzDateTime as nzTime } from '../../common/time.js';
import type { OutgoingEmail } from './email.service.js';

// Short bilingual emails; the polished templates and .ics attachments arrive in M7 (DESIGN §12).
// Payloads carry everything needed to render: nothing is read from the database at send time.

// Type aliases (not interfaces) so they are assignable to Prisma JSON.
export type OrderConfirmedPayload = {
  publicCode: string;
  listingTitle: string;
  seq: number;
  items: { name: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  orderUrl: string;
  pickup: { label: string; address: string } | null;
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

export class UnknownTemplateError extends Error {}


export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Plain lines → text body, and an HTML body with every line escaped (merchant and buyer text is untrusted). */
function email(to: string, subject: string, lines: string[], link?: { label: string; url: string }): OutgoingEmail {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.url}`] : [])].join('\n');
  const html = [
    ...lines.map((l) => (l ? `<p>${escapeHtml(l)}</p>` : '')),
    link ? `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>` : '',
  ].join('\n');
  return { to, subject, text, html };
}

export function renderEmail(type: string, locale: string, to: string, payload: unknown): OutgoingEmail {
  const zh = locale !== 'en';
  switch (type) {
    case 'ORDER_CONFIRMED': {
      const p = payload as OrderConfirmedPayload;
      const items = p.items.map((i) => `${i.name} ×${i.quantity}  ${money(i.unitPriceCents * i.quantity)}`);
      const pickup = p.pickup ? [zh ? `取货：${p.pickup.label}，${p.pickup.address}` : `Pickup: ${p.pickup.label}, ${p.pickup.address}`] : [];
      return email(
        to,
        zh ? `接龙成功 #${p.seq}：${p.listingTitle}` : `You're in (#${p.seq}): ${p.listingTitle}`,
        [
          zh ? `付款成功，你是第 ${p.seq} 位。订单号 ${p.publicCode}` : `Payment received. You are #${p.seq}. Order ${p.publicCode}`,
          ...items,
          zh ? `合计 ${money(p.totalCents)}（含 GST）` : `Total ${money(p.totalCents)} (incl. GST)`,
          ...pickup,
        ],
        { label: zh ? '查看订单' : 'View your order', url: p.orderUrl },
      );
    }
    case 'ORDER_AUTO_REFUNDED': {
      const p = payload as OrderAutoRefundedPayload;
      return email(
        to,
        zh ? `已自动退款：${p.listingTitle}` : `Refunded: ${p.listingTitle}`,
        [
          zh
            ? `你的付款在预留时间结束后才到账，而名额已经被订完，所以我们已全额退款 ${money(p.totalCents)}。订单号 ${p.publicCode}`
            : `Your payment arrived after your reservation ended and the places had sold out, so we refunded ${money(p.totalCents)} in full. Order ${p.publicCode}`,
          zh ? '退款通常在 5–10 个工作日内回到原支付方式。' : 'Refunds usually reach your card within 5–10 business days.',
        ],
        { label: zh ? '查看接龙' : 'View the listing', url: p.listingUrl },
      );
    }
    case 'REGISTRATION_CONFIRMED': {
      const p = payload as RegistrationConfirmedPayload;
      const until = p.selfCancelUntil ? nzTime(p.selfCancelUntil, locale) : null;
      const cancelLine = !p.canSelfCancel
        ? []
        : [until ? (zh ? `如需取消，请在 ${until} 前通过下面的链接操作。` : `To cancel, use the link below before ${until}.`) : zh ? '如需取消，可通过下面的链接操作。' : 'To cancel, use the link below.'];
      return email(
        to,
        zh ? `报名成功 #${p.seq}：${p.listingTitle}` : `You're registered (#${p.seq}): ${p.listingTitle}`,
        [
          zh ? `报名成功，你是第 ${p.seq} 位。报名号 ${p.publicCode}` : `You're registered as #${p.seq}. Reference ${p.publicCode}`,
          ...p.items.map((i) => `${i.name} ×${i.quantity}`),
          ...(p.pickup ? [zh ? `地点：${p.pickup.label}，${p.pickup.address}` : `Place: ${p.pickup.label}, ${p.pickup.address}`] : []),
          ...cancelLine,
        ],
        { label: zh ? '查看报名' : 'View your registration', url: p.orderUrl },
      );
    }
    case 'REGISTRATION_CANCELLED': {
      const p = payload as RegistrationCancelledPayload;
      return email(
        to,
        zh ? `报名已被取消：${p.listingTitle}` : `Registration cancelled: ${p.listingTitle}`,
        [
          zh ? `商家取消了你在「${p.listingTitle}」的报名。` : `The organiser cancelled your registration for "${p.listingTitle}".`,
          ...(p.reason ? [zh ? `原因：${p.reason}` : `Reason: ${p.reason}`] : []),
        ],
        { label: zh ? '查看接龙' : 'View the listing', url: p.listingUrl },
      );
    }
    case 'ORDER_REFUNDED': {
      const p = payload as OrderRefundedPayload;
      const full = p.refundedCents >= p.totalCents;
      return email(
        to,
        zh ? `已退款 ${money(p.amountCents)}：${p.listingTitle}` : `Refund of ${money(p.amountCents)}: ${p.listingTitle}`,
        [
          zh ? `商家已为订单 ${p.publicCode} 退款 ${money(p.amountCents)}${full ? '（全额）' : ''}。` : `The seller refunded ${money(p.amountCents)}${full ? ' (in full)' : ''} for order ${p.publicCode}.`,
          ...(p.reason ? [zh ? `原因：${p.reason}` : `Reason: ${p.reason}`] : []),
          zh ? '退款通常在 5–10 个工作日内回到原支付方式。' : 'Refunds usually reach your card within 5–10 business days.',
        ],
        { label: zh ? '查看订单' : 'View your order', url: p.orderUrl },
      );
    }
    case 'MERCHANT_DISPUTE': {
      const p = payload as MerchantDisputePayload;
      return email(to, zh ? `付款争议：订单 ${p.publicCode}` : `Payment dispute: order ${p.publicCode}`, [
        zh
          ? `买家对「${p.listingTitle}」的订单 ${p.publicCode}（${money(p.amountCents)}）提出了付款争议，原因：${p.reason}。请尽快在 Stripe Dashboard 提交证据。`
          : `A buyer disputed order ${p.publicCode} (${money(p.amountCents)}) for "${p.listingTitle}", reason: ${p.reason}. Submit evidence in your Stripe Dashboard soon.`,
      ]);
    }
    case 'REFUND_FAILED': {
      const p = payload as RefundFailedPayload;
      return email(to, zh ? `退款失败：订单 ${p.publicCode}` : `Refund failed: order ${p.publicCode}`, [
        zh
          ? `「${p.listingTitle}」订单 ${p.publicCode} 的 ${money(p.amountCents)} 退款多次尝试仍未成功（${p.error}）。这笔钱没有退回，可以在订单列表重新退款，或在 Stripe Dashboard 处理。`
          : `The ${money(p.amountCents)} refund on order ${p.publicCode} for "${p.listingTitle}" failed after several tries (${p.error}). Nothing was refunded; refund again from your orders, or in your Stripe Dashboard.`,
      ]);
    }
    case 'CANCELLATION_FINISHED': {
      const p = payload as CancellationFinishedPayload;
      return email(to, zh ? `接龙已取消：${p.listingTitle}` : `Listing cancelled: ${p.listingTitle}`, [
        zh ? `退款完成 ${p.succeeded} 笔，失败 ${p.failed} 笔。` : `${p.succeeded} refund(s) done, ${p.failed} failed.`,
        ...(p.failed ? [zh ? '失败的退款会由平台跟进处理。' : 'The platform will follow up on the failed refunds.'] : []),
      ]);
    }
    case 'PICKUP_POINT_CHANGED': {
      const p = payload as PickupPointChangedPayload;
      return email(to, zh ? '取货地点已变更' : 'Your pickup point changed', [
        zh ? `新的取货地点：${p.label}，${p.address}` : `New pickup point: ${p.label}, ${p.address}`,
      ]);
    }
    case 'ADMIN_SIGN_IN': {
      const p = payload as AdminSignInPayload;
      return email(to, 'TagAlong admin sign-in', [`${p.adminEmail} signed in to the admin console at ${p.signedInAt} (session ${p.sessionId}).`]);
    }
    default:
      throw new UnknownTemplateError(`No email template for ${type}`);
  }
}
