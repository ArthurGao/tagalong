// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import type { PublicOrder } from '@/lib/api/public';
import { OrderView } from './OrderView';

// Boundaries: the API client (cancel) and the order fetcher (polling).
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
const fetchOrder = vi.fn();
vi.mock('@/lib/api/public', () => ({ fetchOrder: (...args: unknown[]) => fetchOrder(...args) }));

const t = messages.public.order;
const order = (over: Partial<PublicOrder> = {}): PublicOrder => ({
  publicCode: 'TA-K7M2Q9',
  status: 'PENDING_PAYMENT',
  isFree: false,
  canCancel: true,
  sequenceNo: null,
  buyerName: 'Amy Lee',
  items: [{ name: '2kg', quantity: 2, unitPriceCents: 3900 }],
  subtotalCents: 7800,
  totalCents: 7800,
  refundedCents: 0,
  pickupPoint: { label: 'Albany', address: '1 Main St', windowStart: null, windowEnd: null, notes: null },
  listing: { shortCode: 'abcd2345', title: 'Cherries' },
  createdAt: '2026-10-27T00:00:00.000Z',
  paidAt: null,
  reservationExpiresAt: '2026-10-27T00:30:00.000Z',
  selfCancelUntil: null,
  ...over,
});
const status = () => screen.getByRole('status').textContent;

describe('OrderView', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    post.mockReset();
    fetchOrder.mockReset();
  });

  it('back from Stripe: "confirming" while it polls every 2 s, then the sign-up number once paid', async () => {
    vi.useFakeTimers();
    fetchOrder.mockResolvedValueOnce(order()).mockResolvedValue(order({ status: 'PAID', sequenceNo: 7, canCancel: false }));
    renderWithIntl(<OrderView initial={order()} token="tok" paid />);
    expect(status()).toBe(t.confirming);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchOrder).toHaveBeenCalledWith('TA-K7M2Q9', 'tok');
    expect(status()).toBe(t.confirming);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(status()).toBe(t.paidHeadline.replace('{seq}', '7'));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchOrder).toHaveBeenCalledTimes(2); // stops once paid
  });

  it('after 60 s without the webhook it says the payment was submitted, never "unpaid", and stops polling', async () => {
    vi.useFakeTimers();
    fetchOrder.mockResolvedValue(order());
    renderWithIntl(<OrderView initial={order()} token="tok" paid />);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(status()).toBe(t.submitted);
    expect(screen.queryByText(t.status.PENDING_PAYMENT)).toBeNull();
    expect(screen.queryByRole('button', { name: t.cancel })).toBeNull();
    const calls = fetchOrder.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchOrder).toHaveBeenCalledTimes(calls);
    expect(calls).toBeLessThanOrEqual(30);
  });

  it('an unpaid order (not back from Stripe) can be cancelled after confirming in a dialog', async () => {
    post.mockResolvedValue({ data: order({ status: 'CANCELLED', canCancel: false }) });
    renderWithIntl(<OrderView initial={order()} token="tok" paid={false} />);
    expect(status()).toBe(t.status.PENDING_PAYMENT);
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    fireEvent.click(await screen.findByRole('button', { name: t.cancelConfirm }));
    await waitFor(() => expect(status()).toBe(t.status.CANCELLED));
    expect(post).toHaveBeenCalledWith('/api/v1/public/orders/{publicCode}/cancel', {
      params: { path: { publicCode: 'TA-K7M2Q9' }, header: { 'X-Order-Token': 'tok' } },
    });
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it('explains an automatic refund of a late payment', () => {
    renderWithIntl(<OrderView initial={order({ status: 'EXPIRED', refundedCents: 7800, canCancel: false })} token="tok" paid />);
    expect(status()).toBe(t.autoRefunded);
    expect(screen.getByText(t.refunded.replace('{amount}', '$78.00'))).toBeTruthy();
  });

  describe('free registration', () => {
    const registered = order({
      isFree: true,
      status: 'CONFIRMED',
      sequenceNo: 4,
      totalCents: 0,
      items: [{ name: 'Sat 9am', quantity: 1, unitPriceCents: 0 }],
      canCancel: true,
      selfCancelUntil: '2026-11-01T20:00:00.000Z',
      reservationExpiresAt: null,
    });

    it('shows the sign-up number and the cancel deadline, without prices', () => {
      renderWithIntl(<OrderView initial={registered} token="tok" paid={false} />);
      expect(status()).toBe(t.registeredHeadline.replace('{seq}', '4'));
      expect(screen.getByText(/2 Nov 2026, 09:00/)).toBeTruthy();
      expect(screen.queryByText(/\$/)).toBeNull();
      expect(screen.getByRole('button', { name: t.cancelRegistration })).toBeTruthy();
    });

    it('cancels the registration after confirming', async () => {
      post.mockResolvedValue({ data: { ...registered, status: 'CANCELLED', canCancel: false } });
      renderWithIntl(<OrderView initial={registered} token="tok" paid={false} />);
      fireEvent.click(screen.getByRole('button', { name: t.cancelRegistration }));
      expect(await screen.findByText(t.cancelRegistrationTitle)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: t.cancelConfirm }));
      await waitFor(() => expect(status()).toBe(t.status.CANCELLED));
    });

    it('says "checked in", not "collected", once the organiser checked the buyer in', () => {
      renderWithIntl(<OrderView initial={{ ...registered, status: 'FULFILLED', canCancel: false }} token="tok" paid={false} />);
      expect(screen.getByText(t.status.CHECKED_IN)).toBeTruthy();
      expect(screen.queryByText(t.status.FULFILLED)).toBeNull();
    });
  });
});
