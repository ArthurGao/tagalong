// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, publicListingFixture, renderLive } from '@/test/render';
import type { PublicListing } from '@/lib/api/public';
import { StickyBuyBar } from './StickyBuyBar';

// Network boundary: the public API fetchers (the 15 s refresh).
vi.mock('@/lib/api/public', () => ({ fetchPublicListing: vi.fn(), fetchParticipants: vi.fn() }));

const t = messages.public.listing;
const renderBar = (listing: PublicListing) => renderLive(<StickyBuyBar />, listing);

describe('StickyBuyBar', () => {
  afterEach(cleanup);

  it.each([
    ['PAID', 'OPEN', t.buy.PAID, true],
    ['FREE', 'OPEN', t.buy.FREE, true],
    ['PAID', 'SOLD_OUT', t.state.SOLD_OUT, false],
    ['FREE', 'CLOSED', t.state.CLOSED, false],
    ['PAID', 'SUSPENDED', t.state.SUSPENDED, false],
    ['PAID', 'TAKEN_DOWN', t.state.TAKEN_DOWN, false],
    ['FREE', 'CANCELLED', t.state.CANCELLED, false],
    ['PAID', 'NOT_YET_OPEN', t.state.NOT_YET_OPEN, false],
  ] as const)('%s × %s → "%s", enabled: %s', (pricing, availability, label, enabled) => {
    renderBar(publicListingFixture({ pricing, availability }));
    const button = screen.getByRole('button');
    expect(button.textContent).toBe(label);
    expect(button).toHaveProperty('disabled', !enabled);
  });

  it('shows "from" the lowest price when options differ, and "Free" for free listings', () => {
    const options = [5900, 3900].map((priceCents) => ({ ...publicListingFixture().options[0], priceCents }));
    renderBar(publicListingFixture({ options }));
    expect(screen.getByText('from $39.00')).toBeTruthy();
    cleanup();
    renderBar(publicListingFixture({ options: [options[1], options[1]] }));
    expect(screen.getByText('$39.00')).toBeTruthy(); // same price twice is not a range
    cleanup();
    renderBar(publicListingFixture({ pricing: 'FREE', options: [{ ...options[0], priceCents: 0 }] }));
    expect(screen.getByText(t.free)).toBeTruthy();
  });
});
