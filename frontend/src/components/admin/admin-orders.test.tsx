// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@/lib/api/schema';
import { messages, renderWithIntl } from '@/test/render';
import { AdminNav } from './AdminNav';
import { AnonymizeBuyer } from './AnonymizeBuyer';
import { OrderDetail } from './OrderDetail';
import { RetryRefund } from './RetryRefund';

// Network boundary: the typed API client. Navigation: the Next router.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => '/en/orders' }));

type Order = components['schemas']['AdminOrderDto'];
const t = messages.admin;
const typeLabel = (text: string) => t.confirm.typeToConfirm.replace('{text}', text);

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  publicCode: 'TA-K7M2Q9',
  status: 'PAID',
  isFree: false,
  buyerName: 'Amy L.',
  buyerEmail: 'a***@example.com',
  buyerPhone: '*** 0101',
  anonymized: false,
  totalCents: 3900,
  refundedCents: 0,
  pendingRefundCents: 0,
  refundableCents: 3900,
  lastRefundFailed: false,
  openDispute: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  paidAt: '2026-10-01T00:00:00.000Z',
  listing: { id: 'l1', shortCode: 'abcd2345', title: 'Cherries' },
  merchant: { id: 'm1', slug: 'kiwi-fruit', displayName: 'Kiwi Fruit', status: 'ACTIVE' },
  items: [{ name: '2kg', quantity: 1, unitPriceCents: 3900 }],
  refunds: [],
  pickupPointLabel: null,
  ...over,
});

afterEach(() => {
  cleanup();
  post.mockReset();
  refresh.mockReset();
});

/** Opens the ConfirmWithReason dialog behind `label` and types the reason. */
function openWithReason(label: string, reason: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(t.confirm.reason), { target: { value: reason } });
  return { dialog, confirm: within(dialog).getByRole('button', { name: t.confirm.confirm }) as HTMLButtonElement };
}

describe('MaskedPii (in the order drawer)', () => {
  it('shows the buyer masked, and in full only after a reveal with a reason', async () => {
    post.mockResolvedValue({
      data: {
        buyerName: 'Amy Lee',
        buyerEmail: 'amy.lee@example.com',
        buyerPhone: '021 555 0101',
        buyerNote: 'Gate code 42',
        formAnswers: { allergies: 'nuts' },
        items: [{ optionName: '2kg', attendeeName: 'Amy', attendeeAnswers: [{ shirt: 'M' }] }],
      },
    });
    renderWithIntl(<OrderDetail order={order()} />);
    expect(screen.getByText('a***@example.com')).toBeTruthy();
    expect(screen.queryByText('amy.lee@example.com')).toBeNull();

    const { confirm } = openWithReason(t.orders.reveal, '  Complaint #12 ');
    fireEvent.click(confirm);
    expect(await screen.findByText('amy.lee@example.com')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/api/v1/admin/orders/{id}/reveal-pii', { params: { path: { id: 'o1' } }, body: { reason: 'Complaint #12' } });
    expect(screen.queryByText('a***@example.com')).toBeNull();
    expect(screen.getByText('021 555 0101')).toBeTruthy();
    expect(screen.getByText('Gate code 42')).toBeTruthy();
    expect(screen.getByText('nuts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.orders.reveal })).toBeNull();
    expect(refresh).not.toHaveBeenCalled(); // a reload would mask them again
  });

  it('stays masked, with the error, when the reveal is refused', async () => {
    post.mockResolvedValue({ error: { code: 'NOT_FOUND' } });
    renderWithIntl(<OrderDetail order={order()} />);
    const { dialog, confirm } = openWithReason(t.orders.reveal, 'Complaint');
    fireEvent.click(confirm);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(messages.errors.NOT_FOUND);
    expect(screen.getAllByText('a***@example.com').length).toBeGreaterThan(0);
  });
});

describe('OrderDetail refund', () => {
  it('takes dollars, sends cents, and allows no more than is left', async () => {
    post.mockResolvedValue({ data: order() });
    renderWithIntl(<OrderDetail order={order({ refundableCents: 2900, refundedCents: 1000 })} />);
    const { dialog, confirm } = openWithReason(t.orders.refund, 'Never delivered');
    const amount = within(dialog).getByLabelText(t.orders.refundAmount) as HTMLInputElement;
    expect(amount.value).toBe('29.00');
    fireEvent.change(amount, { target: { value: '29.01' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: '0' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: 'abc' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: '19.5' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/admin/orders/{id}/refund', { params: { path: { id: 'o1' } }, body: { amountCents: 1950, reason: 'Never delivered' } });
  });

  it('reads a fulfilled free registration as checked in, as the merchant and buyer pages do', () => {
    renderWithIntl(<OrderDetail order={order({ isFree: true, status: 'FULFILLED', totalCents: 0, refundableCents: 0 })} />);
    expect(screen.getByText(new RegExp(`^${messages.orders.status.CHECKED_IN} ·`))).toBeTruthy();
  });

  it('offers no refund when nothing is refundable', () => {
    renderWithIntl(<OrderDetail order={order({ status: 'REFUNDED', refundableCents: 0, refundedCents: 3900 })} />);
    expect(screen.queryByRole('button', { name: t.orders.refund })).toBeNull();
  });
});

describe('AnonymizeBuyer', () => {
  it('needs an email, a reason and the email typed again; then reports what was anonymized', async () => {
    post.mockResolvedValue({ data: { orderCount: 2, publicCodes: ['TA-AAAAAA', 'TA-BBBBBB'] } });
    renderWithIntl(<AnonymizeBuyer />);
    const email = screen.getByLabelText(t.orders.anonymizeEmail);
    fireEvent.change(email, { target: { value: 'amy' } });
    expect(screen.queryByRole('button', { name: t.orders.anonymize })).toBeNull();
    fireEvent.change(email, { target: { value: ' amy@example.com ' } });
    const { dialog, confirm } = openWithReason(t.orders.anonymize, 'Privacy request #7');
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(typeLabel('amy@example.com')), { target: { value: 'amy@example.co' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(typeLabel('amy@example.com')), { target: { value: 'amy@example.com' } });
    fireEvent.click(confirm);
    expect((await screen.findByRole('status')).textContent).toBe('Anonymized 2 orders: TA-AAAAAA, TA-BBBBBB');
    expect(post).toHaveBeenCalledWith('/api/v1/admin/buyers/anonymize', { body: { email: 'amy@example.com', reason: 'Privacy request #7' } });
  });

  it('explains a refusal', async () => {
    post.mockResolvedValue({ error: { code: 'ANONYMIZE_BLOCKED', details: { publicCodes: ['TA-AAAAAA'] } } });
    renderWithIntl(<AnonymizeBuyer />);
    fireEvent.change(screen.getByLabelText(t.orders.anonymizeEmail), { target: { value: 'amy@example.com' } });
    const { dialog, confirm } = openWithReason(t.orders.anonymize, 'Privacy request');
    fireEvent.change(within(dialog).getByLabelText(typeLabel('amy@example.com')), { target: { value: 'amy@example.com' } });
    fireEvent.click(confirm);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(messages.errors.ANONYMIZE_BLOCKED);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('RetryRefund', () => {
  it('retries one failed refund with a reason, then refreshes', async () => {
    post.mockResolvedValue({ data: {} });
    renderWithIntl(<RetryRefund taskId="task-1" publicCode="TA-K7M2Q9" amountCents={3900} />);
    const { dialog, confirm } = openWithReason(t.cancellations.retry, 'Stripe is back');
    expect(within(dialog).getByText(t.cancellations.retryTitle.replace('{amount}', '$39.00').replace('{code}', 'TA-K7M2Q9'))).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/admin/refund-tasks/{id}/retry', { params: { path: { id: 'task-1' } }, body: { reason: 'Stripe is back' } });
  });
});

describe('AdminNav (M8b sections)', () => {
  it('links every console section on the admin host’s own paths', () => {
    renderWithIntl(<AdminNav />);
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      [t.nav.overview, '/en'],
      [t.nav.merchants, '/en/merchants'],
      [t.nav.listings, '/en/listings'],
      [t.nav.orders, '/en/orders'],
      [t.nav.cancellations, '/en/cancellations'],
      [t.nav.disputes, '/en/disputes'],
      [t.nav.audit, '/en/audit-log'],
    ]);
    expect(screen.getByRole('link', { current: 'page' }).textContent).toBe(t.nav.orders);
  });
});
