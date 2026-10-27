import { formatCents as money } from '../../common/money.js';
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
