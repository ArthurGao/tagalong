// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicListingFixture } from '@/test/render';
import type { PublicListing } from '@/lib/api/public';
import { LiveListingProvider, useLiveListing } from './live-listing';

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
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(fetchPublicListing).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(100)); // let TanStack flush its batched render notification
    expect(container.textContent).toBe('2');
  });

  it('stops polling a listing that can no longer change', async () => {
    mount(publicListingFixture({ availability: 'CLOSED' }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchPublicListing).not.toHaveBeenCalled();
  });
});
