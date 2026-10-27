import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import messages from '../../messages/en.json';
import { NZ_TIME_ZONE } from '@/lib/time';
import type { Listing } from '@/components/merchant/listing-editor/types';

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
