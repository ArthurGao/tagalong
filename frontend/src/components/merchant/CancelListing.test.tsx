// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import { CancelListing, CancellationProgress } from './CancelListing';

// Network boundary: the typed API client.
const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...a: unknown[]) => post(...a), GET: (...a: unknown[]) => get(...a) } }));

const t = messages.listings.cancel;
const progress = (status: 'RUNNING' | 'COMPLETED', succeeded = 0) => ({ status, totalOrders: 3, succeeded, failed: 0, pending: 3 - succeeded, finishedAt: null });

describe('CancelListing', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    post.mockReset();
    get.mockReset();
  });

  it('shows what will happen, and cancels only with a reason and the exact title typed', async () => {
    get.mockResolvedValue({ data: { paidOrders: 3, refundTotalCents: 11700, registrations: 0, unpaidOrders: 1 } });
    post.mockResolvedValue({ data: progress('RUNNING') });
    const onCancelled = vi.fn();
    renderWithIntl(<CancelListing listingId="l1" title="Cherries" onCancelled={onCancelled} />);
    fireEvent.click(screen.getByRole('button', { name: t.button }));
    expect(await screen.findByText('3 paid orders will be refunded in full: $117.00')).toBeTruthy();
    expect(screen.getByText(t.feesNotReturned)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: t.confirm });
    fireEvent.change(screen.getByLabelText(t.reason), { target: { value: 'Storm' } });
    fireEvent.change(screen.getByLabelText(t.typeTitle.replace('{title}', 'Cherries')), { target: { value: 'Cherrie' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(t.typeTitle.replace('{title}', 'Cherries')), { target: { value: 'Cherries' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(progress('RUNNING')));
    expect(post).toHaveBeenCalledWith('/api/v1/merchants/me/listings/{id}/cancel', { params: { path: { id: 'l1' } }, body: { reason: 'Storm', confirmTitle: 'Cherries' } });
  });

  it('polls the refund progress until it is done, then stops', async () => {
    vi.useFakeTimers();
    get.mockResolvedValueOnce({ data: progress('RUNNING', 1) }).mockResolvedValue({ data: { ...progress('COMPLETED', 3), pending: 0 } });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CancellationProgress listingId="l1" initial={progress('RUNNING')} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Refunding: 0 of 3 done');
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByRole('status').textContent).toBe('Refunding: 1 of 3 done');
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByRole('status').textContent).toBe('All 3 refunds are done.');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
