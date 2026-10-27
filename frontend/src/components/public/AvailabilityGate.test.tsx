// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages, poll, publicListingFixture, renderLive } from '@/test/render';
import { LiveListingProvider } from './live-listing';
import { AvailabilityGate } from './AvailabilityGate';

// Boundaries: the public API fetchers and the Next router.
const fetchPublicListing = vi.fn();
vi.mock('@/lib/api/public', () => ({
  fetchPublicListing: (...args: unknown[]) => fetchPublicListing(...args),
  fetchParticipants: vi.fn(),
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const n = messages.public.listing.stateNotice;
const page = <h1>Cherries 2kg</h1>;

describe('AvailabilityGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    fetchPublicListing.mockReset();
    refresh.mockReset();
  });

  it('replaces an already rendered page with the notice when polling sees a takedown, and refreshes the server parts', async () => {
    const listing = publicListingFixture();
    fetchPublicListing.mockResolvedValue({ ...listing, availability: 'TAKEN_DOWN' });
    renderLive(<AvailabilityGate>{page}</AvailabilityGate>, listing);
    expect(screen.getByRole('heading').textContent).toBe('Cherries 2kg');
    expect(refresh).not.toHaveBeenCalled();
    await poll();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(n.TAKEN_DOWN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the paused / cancelled notice above the page, following live data', async () => {
    const listing = publicListingFixture({ availability: 'SUSPENDED' });
    fetchPublicListing.mockResolvedValue({ ...listing, availability: 'CLOSED' });
    renderLive(<AvailabilityGate>{page}</AvailabilityGate>, listing);
    expect(screen.getByRole('status').textContent).toBe(n.SUSPENDED);
    expect(screen.getByRole('heading')).toBeTruthy();
    await poll(60_000); // suspended polls slowly
    expect(screen.queryByRole('status')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps refreshing until the server-rendered page catches up (the first refresh can be a stale ISR copy)', async () => {
    const listing = publicListingFixture();
    const takenDown = { ...listing, availability: 'TAKEN_DOWN' as const };
    fetchPublicListing.mockResolvedValue(takenDown);
    const { rerender } = renderLive(<AvailabilityGate>{page}</AvailabilityGate>, listing);
    await poll();
    expect(refresh).toHaveBeenCalledTimes(1);
    await poll(11_000); // server still renders the old state → refresh again
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender(
      <LiveListingProvider initial={{ listing: takenDown, participants: null }}>
        <AvailabilityGate>{page}</AvailabilityGate>
      </LiveListingProvider>,
    );
    await poll(30_000); // server caught up: no more refreshes
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
