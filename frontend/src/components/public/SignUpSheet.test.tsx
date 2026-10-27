// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, publicListingFixture, renderWithIntl } from '@/test/render';
import type { ParticipantPage, PublicListing } from '@/lib/api/public';
import { LiveListingProvider } from './live-listing';
import { SignUpSheet } from './SignUpSheet';

// Network boundary: the public API fetchers.
const fetchParticipants = vi.fn();
vi.mock('@/lib/api/public', () => ({
  fetchPublicListing: vi.fn(),
  fetchParticipants: (...args: unknown[]) => fetchParticipants(...args),
}));

const t = messages.public.listing;
const row = (seq: number, displayName: string | null) => ({
  seq,
  displayName,
  anonymous: displayName === null,
  summary: '2kg ×1',
  joinedAt: '2026-10-27T01:00:00.000Z',
});
const renderSheet = (listing: PublicListing, participants: ParticipantPage | null) =>
  renderWithIntl(
    <LiveListingProvider initial={{ listing, participants }}>
      <SignUpSheet />
    </LiveListingProvider>,
  );

describe('SignUpSheet', () => {
  afterEach(() => {
    cleanup();
    fetchParticipants.mockReset();
  });

  it('numbers rows by seq, newest first, and shows anonymous buyers as "Anonymous"', () => {
    renderSheet(publicListingFixture(), { items: [row(3, 'Amy L.'), row(2, null), row(1, '高*')], nextCursor: null });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.slice(0, 2))).toEqual(['#3', '#2', '#1']);
    expect(items[0].textContent).toContain('Amy L.');
    expect(items[1].textContent).toContain(t.anonymous);
    expect(items[2].textContent).toContain('高*');
    expect(screen.queryByRole('button', { name: t.showMore })).toBeNull();
  });

  it('loads the next page from the cursor when "Show more" is pressed', async () => {
    fetchParticipants.mockResolvedValueOnce({ items: [row(1, 'Bo C.')], nextCursor: null });
    renderSheet(publicListingFixture(), { items: [row(2, 'Amy L.')], nextCursor: 2 });
    fireEvent.click(screen.getByRole('button', { name: t.showMore }));
    expect(await screen.findByText('Bo C.')).toBeTruthy();
    expect(fetchParticipants).toHaveBeenCalledWith('abcd2345', 2);
  });

  it('renders nothing when the merchant hides the list', () => {
    const { container } = renderSheet(publicListingFixture({ showParticipants: false }), null);
    expect(container.textContent).toBe('');
  });

  it('uses the free-listing wording for free listings', () => {
    renderSheet(publicListingFixture({ pricing: 'FREE' }), { items: [], nextCursor: null });
    expect(screen.getByRole('heading').textContent).toBe(t.sheet.FREE);
    expect(screen.getByText(t.sheetEmpty)).toBeTruthy();
  });
});
