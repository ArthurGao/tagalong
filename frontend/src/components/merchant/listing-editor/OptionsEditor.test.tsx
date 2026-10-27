// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionsEditor } from './OptionsEditor';
import { listingFixture, messages, renderWithIntl } from '@/test/render';

const put = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { PUT: (...args: unknown[]) => put(...args) } }));
const o = messages.listings.options;

describe('OptionsEditor', () => {
  afterEach(() => {
    cleanup();
    put.mockReset();
  });

  it('sends dollar prices as integer cents and blank capacity as unlimited', async () => {
    const listing = listingFixture();
    put.mockResolvedValueOnce({ data: listing });
    renderWithIntl(<OptionsEditor listing={listing} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(o.name), { target: { value: '2kg' } });
    fireEvent.change(screen.getByLabelText(o.price), { target: { value: '0.29' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1].body.options).toEqual([
      { name: '2kg', priceCents: 29, capacity: null, startsAt: null, endsAt: null, location: null, active: true },
    ]);
  });

  it('sends the revision it is based on, and after saving reuses the ids the server assigned', async () => {
    const listing = listingFixture({ revision: 4 });
    const saved = listingFixture({
      revision: 5,
      options: [
        { id: 'opt-new', name: '2kg', priceCents: 3900, capacity: null, soldCount: 0, reservedCount: 0, startsAt: null, endsAt: null, location: null, sortOrder: 0, active: true },
      ],
    });
    put.mockResolvedValue({ data: saved });
    let current = listing;
    const { rerender } = renderWithIntl(<OptionsEditor listing={current} onSaved={(l) => (current = l)} />);
    fireEvent.change(screen.getByLabelText(o.name), { target: { value: '2kg' } });
    fireEvent.change(screen.getByLabelText(o.price), { target: { value: '39' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1].body.revision).toBe(4);

    rerender(<OptionsEditor listing={current} onSaved={(l) => (current = l)} />);
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][1].body).toMatchObject({ revision: 5, options: [{ id: 'opt-new', name: '2kg', priceCents: 3900 }] });
  });

  it('refuses a price it cannot read, without calling the API', async () => {
    renderWithIntl(<OptionsEditor listing={listingFixture()} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(o.name), { target: { value: '2kg' } });
    fireEvent.change(screen.getByLabelText(o.price), { target: { value: '39.999' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    expect(await screen.findByText(o.priceInvalid)).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('free listings have no price input and always send 0', async () => {
    const listing = listingFixture({ pricing: 'FREE' });
    put.mockResolvedValueOnce({ data: listing });
    renderWithIntl(<OptionsEditor listing={listing} onSaved={() => {}} />);
    expect(screen.queryByLabelText(o.price)?.tagName).not.toBe('INPUT');
    fireEvent.change(screen.getByLabelText(o.name), { target: { value: 'Seat' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1].body.options[0].priceCents).toBe(0);
  });
});
