// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import { NewListingForm } from './NewListingForm';

// Network boundary: the typed API client; navigation is the framework's.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const t = messages.listings;

describe('NewListingForm', () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
  });

  it('offers paid and free, paid first, while paid listings are on', () => {
    renderWithIntl(<NewListingForm paidListingsEnabled />);
    const pricing = screen.getByLabelText(t.pricingLabel) as HTMLSelectElement;
    expect(within(pricing).getAllByRole('option').map((o) => o.textContent)).toEqual([t.pricing.PAID, t.pricing.FREE]);
    expect(pricing.value).toBe('PAID');
  });

  it('offers and sends only free while the site has paid listings off (DESIGN §13)', async () => {
    post.mockResolvedValue({ data: { id: 'l1' } });
    renderWithIntl(<NewListingForm paidListingsEnabled={false} />);
    const pricing = screen.getByLabelText(t.pricingLabel) as HTMLSelectElement;
    expect(within(pricing).getAllByRole('option').map((o) => o.textContent)).toEqual([t.pricing.FREE]);
    expect(screen.getByText(t.pricingFreeOnly)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t.fields.title), { target: { value: 'Bread class' } });
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].body.pricing).toBe('FREE');
  });
});
