// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicListingFixture, renderLive } from '@/test/render';
import { ListingTimeLine } from './ListingTimeLine';

// Network boundary: the public API fetchers.
vi.mock('@/lib/api/public', () => ({ fetchPublicListing: vi.fn(), fetchParticipants: vi.fn() }));

const NOW = new Date('2026-10-27T00:00:00Z');
const inTwoDays = '2026-10-29T03:00:00.000Z';

describe('ListingTimeLine', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(['OPEN', 'SOLD_OUT', 'SUSPENDED'] as const)('%s with a future deadline counts down, never says closed', (availability) => {
    renderLive(<ListingTimeLine />, publicListingFixture({ availability, closesAt: inTwoDays }));
    expect(screen.getByText(/^Closes in 2d 3h$/)).toBeTruthy();
  });

  it.each(['CLOSED', 'CANCELLED'] as const)('%s shows when it closed', (availability) => {
    renderLive(<ListingTimeLine />, publicListingFixture({ availability, closesAt: '2026-10-26T03:00:00.000Z' }));
    expect(screen.getByText(/^Closed /)).toBeTruthy();
  });

  it('shows the opening time before a listing opens', () => {
    renderLive(<ListingTimeLine />, publicListingFixture({ availability: 'NOT_YET_OPEN', opensAt: inTwoDays }));
    expect(screen.getByText(/^Opens /)).toBeTruthy();
  });
});
