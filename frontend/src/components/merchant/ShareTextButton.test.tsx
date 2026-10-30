// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@/lib/api/schema';
import { messages, renderWithIntl } from '@/test/render';
import { LocaleSwitch } from './LocaleSwitch';
import { ShareTextButton } from './ShareTextButton';

const goTo = vi.fn();
vi.mock('@/lib/navigate', () => ({ goTo: (url: string) => goTo(url) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/en/dashboard/listings' }));

type Summary = components['schemas']['ListingSummaryDto'];
const listing: Summary = {
  id: 'l1', shortCode: 'abc12345', title: 'Cherries', status: 'PUBLISHED', pricing: 'PAID', type: 'RETAIL', soldCount: 23, totalCapacity: 30,
  closesAt: null, createdAt: '2026-10-01T00:00:00Z',
  share: { minPriceCents: 3900, maxPriceCents: 3900, remaining: 7, place: 'Albany', startsAt: null },
};

afterEach(cleanup);

describe('ShareTextButton', () => {
  it('copies the group-chat message with a link to this site', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithIntl(<ShareTextButton listing={listing} />);
    fireEvent.click(screen.getByRole('button', { name: messages.listings.share.button }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(messages.listings.share.copied));
    expect(writeText).toHaveBeenCalledWith(`[Group buy] Cherries $39.00 | Albany\n23 joined, 7 left 👉 ${window.location.origin}/l/abc12345`);
  });
});

describe('merchant LocaleSwitch', () => {
  it('switches the console language in place', () => {
    window.history.pushState({}, '', '/en/dashboard/listings?status=PUBLISHED');
    renderWithIntl(<LocaleSwitch />);
    fireEvent.click(screen.getByRole('link', { name: messages.common.switchToLabel }));
    expect(goTo).toHaveBeenCalledWith('/zh-CN/dashboard/listings?status=PUBLISHED');
  });
});
