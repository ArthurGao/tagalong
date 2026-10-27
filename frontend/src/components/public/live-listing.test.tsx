// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { poll, publicListingFixture } from '@/test/render';
import type { PublicListing } from '@/lib/api/public';
import { listingRefreshMs, LiveListingProvider, useLiveListing } from './live-listing';

// Network boundary: the public API fetchers.
const fetchPublicListing = vi.fn();
vi.mock('@/lib/api/public', () => ({
  fetchPublicListing: (...args: unknown[]) => fetchPublicListing(...args),
  fetchParticipants: vi.fn(),
}));

function Probe() {
  return <span>{useLiveListing().joinedCount}</span>;
}
const mount = (listing: PublicListing) =>
  render(
    <LiveListingProvider initial={{ listing, participants: null }}>
      <Probe />
    </LiveListingProvider>,
  );

describe('LiveListingProvider polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fetchPublicListing.mockReset();
  });

  it('uses the server data on mount, then refreshes an open listing every 15 s', async () => {
    const listing = publicListingFixture({ joinedCount: 1 });
    fetchPublicListing.mockResolvedValue({ ...listing, joinedCount: 2 });
    const { container } = mount(listing);
    expect(fetchPublicListing).not.toHaveBeenCalled();
    await poll();
    expect(fetchPublicListing).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('2');
  });

  it.each([
    ['OPEN', 15_000],
    ['NOT_YET_OPEN', 15_000],
    ['SOLD_OUT', 15_000],
    ['CLOSED', 60_000],
    ['SUSPENDED', 60_000],
    ['TAKEN_DOWN', 60_000],
    ['CANCELLED', false],
  ] as const)('polls a %s listing every %s ms (reversible states slowly, CANCELLED never)', (availability, ms) => {
    expect(listingRefreshMs(availability)).toBe(ms);
  });

  it('picks up a reopen of a closed listing on the slow poll', async () => {
    const closed = publicListingFixture({ availability: 'CLOSED' });
    fetchPublicListing.mockResolvedValue({ ...closed, availability: 'OPEN', joinedCount: 4 });
    const { container } = mount(closed);
    await poll();
    expect(fetchPublicListing).not.toHaveBeenCalled();
    await poll(45_000);
    expect(container.textContent).toBe('4');
  });

  it('keeps the last good data when a poll fails', async () => {
    const listing = publicListingFixture({ joinedCount: 1 });
    fetchPublicListing.mockResolvedValueOnce({ ...listing, joinedCount: 2 }).mockResolvedValue(null);
    const { container } = mount(listing);
    await poll();
    expect(container.textContent).toBe('2');
    await poll();
    expect(container.textContent).toBe('2');
    await poll(10_000); // before the next tick: a failed poll is not retried (the next tick is the retry)
    expect(fetchPublicListing).toHaveBeenCalledTimes(2);
  });
});
