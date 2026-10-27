// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import type { components } from '@/lib/api/schema';
import { OrderList } from './OrderList';

// Network boundary: the typed API client.
const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...a: unknown[]) => post(...a), GET: (...a: unknown[]) => get(...a) } }));

type Order = components['schemas']['MerchantOrderDto'];
const t = messages.orders;
const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  publicCode: 'TA-1',
  sequenceNo: 3,
  status: 'CONFIRMED',
  isFree: true,
  buyerName: 'Amy Lee',
  buyerEmail: 'amy@example.test',
  buyerPhone: '021 555 0101',
  buyerNote: null,
  displayAnonymous: false,
  formAnswers: { diet: 'Vegan' },
  items: [{ name: 'Sat 9am', quantity: 1, unitPriceCents: 0, attendeeAnswers: [{ age: 7 }] }],
  totalCents: 0,
  refundedCents: 0,
  pickupPointLabel: null,
  createdAt: '2026-10-27T00:00:00.000Z',
  paidAt: null,
  fulfilledAt: null,
  cancelledAt: null,
  canFulfil: true,
  canCancel: true,
  canNoShow: false,
  refundableCents: 0,
  ...over,
});
const data = (orders: Order[], pricing: 'FREE' | 'PAID' = 'FREE') => ({
  listing: { id: 'l1', title: 'Yoga', pricing, status: 'PUBLISHED' as const },
  orders,
});

describe('OrderList (merchant registrations)', () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
    get.mockReset();
  });

  it('shows each registration with its answers and checks a buyer in', async () => {
    post.mockResolvedValue({ data: order({ status: 'FULFILLED', fulfilledAt: '2026-10-28T00:00:00.000Z', canFulfil: false, canCancel: false }) });
    renderWithIntl(<OrderList initial={data([order()])} />);
    const row = screen.getByRole('listitem');
    expect(row.textContent).toContain('#3 Amy Lee');
    expect(row.textContent).toContain('diet: Vegan');
    expect(row.textContent).toContain('age: 7');
    expect(within(row).queryByRole('button', { name: t.noShow })).toBeNull(); // the event has not started (canNoShow)
    fireEvent.click(within(row).getByRole('button', { name: t.checkIn }));
    await waitFor(() => expect(row.textContent).toContain(t.status.CHECKED_IN));
    expect(post).toHaveBeenCalledWith('/api/v1/merchants/me/orders/{id}/fulfil', { params: { path: { id: 'o1' } } });
    expect(within(row).queryByRole('button', { name: t.checkIn })).toBeNull();
  });

  it('cancels only with a reason, which is sent to the backend', async () => {
    post.mockResolvedValue({ data: order({ status: 'CANCELLED' }) });
    renderWithIntl(<OrderList initial={data([order()])} />);
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    const confirm = await screen.findByRole('button', { name: t.confirmCancel });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(t.reason), { target: { value: 'Venue flooded' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole('listitem').textContent).toContain(t.status.CANCELLED));
    expect(post).toHaveBeenCalledWith('/api/v1/merchants/me/orders/{id}/cancel', { params: { path: { id: 'o1' } }, body: { reason: 'Venue flooded' } });
  });

  it('shows exactly the actions the backend allows: paid orders get "mark collected", no-show only once allowed', () => {
    renderWithIntl(<OrderList initial={data([order({ isFree: false, status: 'PAID', totalCents: 3900, canCancel: false })], 'PAID')} />);
    expect(screen.getByRole('button', { name: t.fulfil })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.cancel })).toBeNull();
    expect(screen.queryByRole('button', { name: t.noShow })).toBeNull();
    cleanup();
    renderWithIntl(<OrderList initial={data([order({ canNoShow: true })])} />);
    expect(screen.getByRole('button', { name: t.noShow })).toBeTruthy();
  });

  it('searches on the server', async () => {
    get.mockResolvedValue({ data: data([order({ buyerName: 'Bob Chen' })]) });
    renderWithIntl(<OrderList initial={data([order()])} />);
    fireEvent.change(screen.getByLabelText(t.search), { target: { value: 'chen' } });
    fireEvent.click(screen.getByRole('button', { name: t.searchButton }));
    await waitFor(() => expect(screen.getByRole('listitem').textContent).toContain('Bob Chen'));
    expect(get.mock.calls[0][1]).toEqual({ params: { path: { id: 'l1' }, query: { q: 'chen' } } });
  });

  it('refunds part of a paid order: the amount is typed in dollars and sent in cents, never over what is left', async () => {
    const paid = order({ isFree: false, status: 'PAID', totalCents: 3900, refundableCents: 3900, canCancel: false });
    post.mockResolvedValue({ data: { ...paid, status: 'PARTIALLY_REFUNDED', refundedCents: 1000, refundableCents: 2900 } });
    renderWithIntl(<OrderList initial={data([paid], 'PAID')} />);
    fireEvent.click(screen.getByRole('button', { name: t.refund }));
    const amount = await screen.findByLabelText(t.refundAmount);
    expect((amount as HTMLInputElement).value).toBe('39.00'); // defaults to all that is left
    fireEvent.change(screen.getByLabelText(t.reason), { target: { value: 'Short delivery' } });
    fireEvent.change(amount, { target: { value: '40' } });
    expect(screen.getByRole('button', { name: t.confirmRefund.replace('{amount}', '$40.00') })).toHaveProperty('disabled', true);
    fireEvent.change(amount, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: t.confirmRefund.replace('{amount}', '$10.00') }));
    await waitFor(() => expect(screen.getByRole('listitem').textContent).toContain(t.refunded.replace('{amount}', '$10.00')));
    expect(post).toHaveBeenCalledWith('/api/v1/merchants/me/orders/{id}/refund', { params: { path: { id: 'o1' } }, body: { amountCents: 1000, reason: 'Short delivery' } });
  });

  it('links the CSV export of this listing', () => {
    renderWithIntl(<OrderList initial={data([order()])} />);
    expect(screen.getByRole('link', { name: t.csv }).getAttribute('href')).toBe('/api/v1/merchants/me/listings/l1/orders.csv');
  });
});
