import { escapeHtml, renderEmail, UnknownTemplateError } from './templates.js';

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
    const zh = renderEmail('ORDER_CONFIRMED', 'zh-CN', 'amy@example.test', confirmed);
    expect(zh.subject).toBe('接龙成功 #12：<b>Cherries</b> & more');
    expect(zh.text).toContain('2kg ×2  $78.00');
    expect(zh.text).toContain('合计 $78.00（含 GST）');
    expect(zh.text).toContain('取货：Albany，1 Main St');
    expect(zh.text).toContain(confirmed.orderUrl);
    const en = renderEmail('ORDER_CONFIRMED', 'en', 'amy@example.test', confirmed);
    expect(en.subject).toBe("You're in (#12): <b>Cherries</b> & more");
  });

  it('escapes merchant- and buyer-written text in the HTML body', () => {
    const { html } = renderEmail('ORDER_CONFIRMED', 'en', 'amy@example.test', {
      ...confirmed,
      items: [{ name: '<script>x</script>', quantity: 1, unitPriceCents: 100 }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; ×1');
    expect(html).toContain('href="https://tagalong.test/o/TA-K7M2Q9?t=abc&amp;paid=1"');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('throws for a type without a template', () => {
    expect(() => renderEmail('NOPE', 'en', 'a@example.test', {})).toThrow(UnknownTemplateError);
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
    const zh = renderEmail('REGISTRATION_CONFIRMED', 'zh-CN', 'amy@example.test', registered);
    expect(zh.subject).toBe('报名成功 #3：Yoga');
    expect(zh.text).toContain('2026年11月2日 09:00'); // 20:00 UTC = 09:00 NZDT next day
    expect(zh.text).toContain(registered.orderUrl);
    const en = renderEmail('REGISTRATION_CONFIRMED', 'en', 'amy@example.test', { ...registered, canSelfCancel: false, selfCancelUntil: null });
    expect(en.text).not.toContain('cancel');
  });

  it('tells the buyer why the organiser cancelled, escaped', () => {
    const { html, subject } = renderEmail('REGISTRATION_CANCELLED', 'en', 'a@example.test', { listingTitle: 'Yoga', reason: '<b>rain</b>', listingUrl: 'https://x' });
    expect(subject).toBe('Registration cancelled: Yoga');
    expect(html).toContain('Reason: &lt;b&gt;rain&lt;/b&gt;');
  });
});

describe('refund email', () => {
  it('says how much, whether it is the whole amount, and why', () => {
    const base = { publicCode: 'TA-1', listingTitle: 'Cherries', amountCents: 1000, refundedCents: 1000, totalCents: 3900, reason: 'Short', orderUrl: 'https://x' };
    const part = renderEmail('ORDER_REFUNDED', 'zh-CN', 'a@example.test', base);
    expect(part.subject).toBe('已退款 $10.00：Cherries');
    expect(part.text).not.toContain('全额');
    expect(part.text).toContain('原因：Short');
    const full = renderEmail('ORDER_REFUNDED', 'en', 'a@example.test', { ...base, amountCents: 2900, refundedCents: 3900, reason: null });
    expect(full.text).toContain('$29.00 (in full)');
    expect(full.text).not.toContain('Reason');
  });
});
