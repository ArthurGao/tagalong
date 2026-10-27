// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listingFixture, messages, renderWithIntl } from '@/test/render';
import { PickupPointsEditor } from './PickupPointsEditor';

const put = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { PUT: (...args: unknown[]) => put(...args) } }));
const p = messages.listings.pickup;

describe('PickupPointsEditor', () => {
  afterEach(() => {
    cleanup();
    put.mockReset();
  });

  it('keeps an untouched pickup window exactly as stored while other fields change', async () => {
    const windowStart = '2026-04-04T14:30:00.000Z'; // the second 02:30 of the repeated autumn hour
    const listing = listingFixture({
      revision: 2,
      pickupPoints: [{ id: 'pp1', label: 'Albany', address: '1 Main St', windowStart, windowEnd: null, notes: null }],
    });
    put.mockResolvedValueOnce({ data: listing });
    renderWithIntl(<PickupPointsEditor listing={listing} onSaved={() => {}} />);
    expect((screen.getByLabelText(p.windowStart) as HTMLInputElement).value).toBe('2026-04-05T02:30');
    fireEvent.change(screen.getByLabelText(p.notes), { target: { value: 'Ring the bell' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1].body).toEqual({
      revision: 2,
      pickupPoints: [{ id: 'pp1', label: 'Albany', address: '1 Main St', windowStart, windowEnd: null, notes: 'Ring the bell' }],
    });
  });

  it('refuses a pickup time that does not exist in New Zealand', async () => {
    renderWithIntl(<PickupPointsEditor listing={listingFixture()} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(p.label), { target: { value: 'Albany' } });
    fireEvent.change(screen.getByLabelText(p.address), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByLabelText(p.windowStart), { target: { value: '2026-09-27T02:30' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    expect(await screen.findByText(messages.listings.timeInvalid)).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });
});
