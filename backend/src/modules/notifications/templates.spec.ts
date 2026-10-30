import { escapeHtml, renderEmail, UnknownTemplateError } from './templates.js';

const CTX = { appUrl: 'https://tagalong.test' };

const confirmed = {
  publicCode: 'TA-K7M2Q9',
  listingTitle: '<b>Cherries</b> & more',
  seq: 12,
  items: [{ name: '2kg', quantity: 2, unitPriceCents: 3900 }],
  totalCents: 7800,
  orderUrl: 'https://tagalong.test/o/TA-K7M2Q9?t=abc&paid=1',
  pickup: { label: 'Albany', address: '1 Main St' },
};

describe('email templates', () => {
  it('renders the confirmation in the buyer language with the amounts and the order link', () => {
    const zh = renderEmail('ORDER_CONFIRMED', 'zh-CN', 'amy@example.test', confirmed, CTX);
    expect(zh.subject).toBe('接龙成功 #12：<b>Cherries</b> & more');
    expect(zh.text).toContain('2kg ×2  $78.00');
    expect(zh.text).toContain('合计 $78.00（含 GST）');
    expect(zh.text).toContain('取货：Albany，1 Main St');
    expect(zh.text).toContain(confirmed.orderUrl);
    const en = renderEmail('ORDER_CONFIRMED', 'en', 'amy@example.test', confirmed, CTX);
    expect(en.subject).toBe("You're in (#12): <b>Cherries</b> & more");
  });

  it('escapes merchant- and buyer-written text in the HTML body', () => {
    const { html } = renderEmail('ORDER_CONFIRMED', 'en', 'amy@example.test', {
      ...confirmed,
      items: [{ name: '<script>x</script>', quantity: 1, unitPriceCents: 100 }],
    }, CTX);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; ×1');
    expect(html).toContain('href="https://tagalong.test/o/TA-K7M2Q9?t=abc&amp;paid=1"');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('throws for a type without a template', () => {
    expect(() => renderEmail('NOPE', 'en', 'a@example.test', {}, CTX)).toThrow(UnknownTemplateError);
  });
});

describe('registration emails', () => {
  const registered = {
    publicCode: 'TA-K7M2Q9',
    listingTitle: 'Yoga',
    seq: 3,
    items: [{ name: 'Sat 9am', quantity: 1 }],
    orderUrl: 'https://tagalong.test/zh-CN/o/TA-K7M2Q9?t=abc',
    pickup: null,
    canSelfCancel: true,
    selfCancelUntil: '2026-11-01T20:00:00.000Z',
  };

  it('confirms with the number, the cancel deadline in Auckland time, and the order link', () => {
    const zh = renderEmail('REGISTRATION_CONFIRMED', 'zh-CN', 'amy@example.test', registered, CTX);
    expect(zh.subject).toBe('报名成功 #3：Yoga');
    expect(zh.text).toContain('2026年11月2日 09:00'); // 20:00 UTC = 09:00 NZDT next day
    expect(zh.text).toContain(registered.orderUrl);
    const en = renderEmail('REGISTRATION_CONFIRMED', 'en', 'amy@example.test', { ...registered, canSelfCancel: false, selfCancelUntil: null }, CTX);
    expect(en.text).not.toContain('cancel');
  });

  it('tells the buyer why the organiser cancelled, escaped', () => {
    const { html, subject } = renderEmail('REGISTRATION_CANCELLED', 'en', 'a@example.test', { listingTitle: 'Yoga', reason: '<b>rain</b>', listingUrl: 'https://x' }, CTX);
    expect(subject).toBe('Registration cancelled: Yoga');
    expect(html).toContain('Reason: &lt;b&gt;rain&lt;/b&gt;');
  });
});

describe('refund email', () => {
  it('says how much, whether it is the whole amount, and why', () => {
    const base = { publicCode: 'TA-1', listingTitle: 'Cherries', amountCents: 1000, refundedCents: 1000, totalCents: 3900, reason: 'Short', orderUrl: 'https://x' };
    const part = renderEmail('ORDER_REFUNDED', 'zh-CN', 'a@example.test', base, CTX);
    expect(part.subject).toBe('已退款 $10.00：Cherries');
    expect(part.text).not.toContain('全额');
    expect(part.text).toContain('原因：Short');
    const full = renderEmail('ORDER_REFUNDED', 'en', 'a@example.test', { ...base, amountCents: 2900, refundedCents: 3900, reason: null }, CTX);
    expect(full.text).toContain('$29.00 (in full)');
    expect(full.text).not.toContain('Reason');
  });
});

describe('layout, receipts and calendar files (M7)', () => {
  const event = {
    uid: 'TA-K7M2Q9-o1@tagalong.nz',
    title: 'Yoga',
    startsAt: '2026-11-07T20:30:00.000Z',
    endsAt: null,
    location: 'Albany Hall',
    description: 'Order TA-K7M2Q9',
    url: 'https://tagalong.test/en/o/TA-K7M2Q9?t=abc',
  };

  it('ends buyer emails with the find-my-orders link, in their language; merchant emails without it', () => {
    const zh = renderEmail('ORDER_CONFIRMED', 'zh-CN', 'amy@example.test', confirmed, CTX);
    expect(zh.text).toContain('找回你的所有订单：https://tagalong.test/zh-CN/find-order');
    expect(zh.html).toContain('<a href="https://tagalong.test/zh-CN/find-order"');
    const en = renderEmail('ORDER_CONFIRMED', 'en', 'amy@example.test', confirmed, CTX);
    expect(en.text).toContain('Find all your orders: https://tagalong.test/en/find-order');
    const merchant = renderEmail('MERCHANT_DISPUTE', 'zh-CN', 'shop@example.test', { publicCode: 'TA-1', listingTitle: 'x', amountCents: 100, reason: 'fraudulent' }, CTX);
    expect(merchant.text).not.toContain('find-order');
  });

  it("shows the seller and its GST number on confirmations and refunds", () => {
    const merchant = { name: 'Kiwi Fruit Co', gstNumber: '123-456-789' };
    expect(renderEmail('ORDER_CONFIRMED', 'zh-CN', 'a@example.test', { ...confirmed, merchant }, CTX).text).toContain('商家：Kiwi Fruit Co · GST 123-456-789');
    expect(renderEmail('ORDER_CONFIRMED', 'en', 'a@example.test', { ...confirmed, merchant: { ...merchant, gstNumber: null } }, CTX).text).toContain('Sold by Kiwi Fruit Co\n');
    const refund = { publicCode: 'TA-1', listingTitle: 'x', amountCents: 100, refundedCents: 100, totalCents: 100, reason: null, orderUrl: 'u', merchant };
    expect(renderEmail('ORDER_REFUNDED', 'en', 'a@example.test', refund, CTX).text).toContain('Sold by Kiwi Fruit Co · GST 123-456-789');
  });

  it('tells the merchant about a takedown, a suspension and a reinstatement, with the reason escaped', () => {
    const kept = renderEmail('LISTING_TAKEN_DOWN', 'en', 'shop@example.test', { listingTitle: 'Cherries', reason: 'Fake <b>brand</b>', refundAll: false }, CTX);
    expect(kept.subject).toBe('Listing taken down: Cherries');
    expect(kept.text).toContain('Reason: Fake <b>brand</b>');
    expect(kept.text).toContain('Existing orders are unchanged.');
    expect(kept.html).toContain('Fake &lt;b&gt;brand&lt;/b&gt;');
    expect(kept.text).not.toContain('find-order');
    const refunded = renderEmail('LISTING_TAKEN_DOWN', 'zh-CN', 'shop@example.test', { listingTitle: '车厘子', reason: '假货', refundAll: true }, CTX);
    expect(refunded.text).toContain('已付款的订单会全额退款');
    const suspended = renderEmail('MERCHANT_SUSPENDED', 'zh-CN', 'shop@example.test', { merchantName: 'Kiwi', reason: '多次投诉' }, CTX);
    expect(suspended.subject).toBe('你的 TagAlong 店铺已被暂停：Kiwi');
    expect(suspended.text).toContain('原因：多次投诉');
    expect(renderEmail('MERCHANT_REINSTATED', 'en', 'shop@example.test', { merchantName: 'Kiwi' }, CTX).subject).toBe('Your TagAlong shop is active again: Kiwi');
  });

  it('attaches the .ics only when the order has sessions', () => {
    const withEvents = renderEmail('ORDER_CONFIRMED', 'en', 'a@example.test', { ...confirmed, events: [event] }, CTX);
    expect(withEvents.attachments).toEqual([
      expect.objectContaining({ filename: 'tagalong-TA-K7M2Q9.ics', contentType: 'text/calendar; charset=utf-8', content: expect.stringContaining('DTSTART:20261107T203000Z') }),
    ]);
    expect(renderEmail('ORDER_CONFIRMED', 'en', 'a@example.test', confirmed, CTX).attachments).toBeUndefined();
  });

  it('reminds in Auckland time with the place and the calendar file', () => {
    const r = renderEmail(
      'EVENT_REMINDER',
      'en',
      'a@example.test',
      { publicCode: 'TA-K7M2Q9', listingTitle: 'Yoga', startsAt: event.startsAt, location: 'Albany Hall', orderUrl: event.url, events: [event] },
      CTX,
    );
    expect(r.subject).toBe('Reminder: Yoga (8 Nov 2026, 09:30)'); // 20:30 UTC = 09:30 NZDT the next day
    expect(r.text).toContain('Where: Albany Hall');
    expect(r.attachments).toHaveLength(1);
  });

  it('lists recovered orders with their links, escaped', () => {
    const r = renderEmail(
      'ORDER_RECOVERY',
      'zh-CN',
      'a@example.test',
      { orders: [{ listingTitle: '<b>Cherries</b>', publicCode: 'TA-1', createdAt: '2026-10-01T00:00:00Z', url: 'https://tagalong.test/zh-CN/o/TA-1?t=x' }] },
      CTX,
    );
    expect(r.subject).toBe('你在 TagAlong 的订单');
    expect(r.text).toContain('https://tagalong.test/zh-CN/o/TA-1?t=x');
    expect(r.html).toContain('&lt;b&gt;Cherries&lt;/b&gt; · TA-1');
    expect(r.html).not.toContain('<b>Cherries');
  });
});
