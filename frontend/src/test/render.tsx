import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import messages from '../../messages/en.json';
import { NZ_TIME_ZONE } from '@/lib/time';
import type { Listing } from '@/components/merchant/listing-editor/types';
import type { ParticipantPage, PublicListing } from '@/lib/api/public';
import { LiveListingProvider } from '@/components/public/live-listing';

export { messages };

// As a wrapper (not a parent element) so rerender() keeps the provider.
export const renderWithIntl = (ui: ReactElement) =>
  render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone={NZ_TIME_ZONE}>
        {children}
      </NextIntlClientProvider>
    ),
  });

/** A public component inside the live-listing provider, seeded like the SSR page. */
export const renderLive = (ui: ReactElement, listing: PublicListing, participants: ParticipantPage | null = null) =>
  renderWithIntl(<LiveListingProvider initial={{ listing, participants }}>{ui}</LiveListingProvider>);

/** With fake timers: run one 15 s poll, then let TanStack flush its batched render notification. */
export const poll = async (ms = 15_000) => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await act(() => vi.advanceTimersByTimeAsync(100));
};

export function listingFixture(over: Partial<Listing> = {}): Listing {
  return {
    id: '0192f0c0-0000-7000-8000-000000000001',
    shortCode: 'abcd2345',
    title: 'Cherries 2kg',
    status: 'DRAFT',
    pricing: 'PAID',
    type: 'RETAIL',
    fulfilment: 'PICKUP',
    soldCount: 0,
    totalCapacity: null,
    closesAt: null,
    createdAt: '2026-10-27T00:00:00.000Z',
    description: '',
    images: [],
    opensAt: null,
    maxQtyPerOrder: 10,
    reservedCount: 0,
    indexable: false,
    showParticipants: true,
    formFields: [],
    formFieldWarnings: [],
    onePerEmail: false,
    allowSelfCancel: false,
    selfCancelUntil: null,
    remindBeforeHours: null,
    policyText: '',
    publishedAt: null,
    closedAt: null,
    options: [],
    pickupPoints: [],
    ...over,
  } as Listing;
}

export function publicListingFixture(over: Partial<PublicListing> = {}): PublicListing {
  return {
    shortCode: 'abcd2345',
    title: 'Cherries 2kg',
    description: '',
    images: [],
    type: 'RETAIL',
    pricing: 'PAID',
    fulfilment: 'PICKUP',
    status: 'PUBLISHED',
    availability: 'OPEN',
    opensAt: null,
    closesAt: null,
    maxQtyPerOrder: 10,
    policyText: 'No refunds after pickup.',
    indexable: false,
    showParticipants: true,
    joinedCount: 0,
    totalCapacity: null,
    totalRemaining: null,
    formFields: [],
    options: [{ id: 'opt-2kg', name: '2kg', priceCents: 3900, remaining: null, startsAt: null, endsAt: null, location: null }],
    pickupPoints: [],
    merchant: { slug: 'farm', displayName: 'Farm', logoUrl: null, verified: true },
    ...over,
  } as PublicListing;
}
