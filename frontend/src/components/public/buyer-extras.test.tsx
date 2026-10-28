// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import type { PublicMerchant } from '@/lib/api/public';
import { FindOrderForm } from './FindOrderForm';
import { LocaleSwitch } from './LocaleSwitch';
import { MerchantListings } from './MerchantListings';
import { WeChatBanner } from './WeChatBanner';

// Boundaries: the API client, full-page navigation, the Turnstile widget and the current path.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
const goTo = vi.fn();
vi.mock('@/lib/navigate', () => ({ goTo: (url: string) => goTo(url) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/en/o/TA-K7M2Q9' }));
vi.mock('./Turnstile', () => ({
  Turnstile: ({ onToken }: { onToken: (token: string) => void }) => {
    useEffect(() => onToken('human'), [onToken]);
    return null;
  },
}));

const setUserAgent = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });

afterEach(() => {
  cleanup();
  post.mockReset();
  goTo.mockReset();
});

describe('WeChatBanner', () => {
  it('shows only inside WeChat, and copies the page link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    setUserAgent('Mozilla/5.0 (iPhone) Safari/604.1');
    renderWithIntl(<WeChatBanner />);
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    setUserAgent('Mozilla/5.0 (iPhone) MicroMessenger/8.0.50');
    renderWithIntl(<WeChatBanner />);
    expect(screen.getByRole('note').textContent).toContain(messages.public.wechat.text);
    fireEvent.click(screen.getByRole('button', { name: messages.public.wechat.copy }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(messages.public.wechat.copied));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });
});

describe('LocaleSwitch', () => {
  it('goes to the same page in the other language, keeping the order token', () => {
    window.history.pushState({}, '', '/en/o/TA-K7M2Q9?t=secret&paid=1');
    renderWithIntl(<LocaleSwitch />);
    const link = screen.getByRole('link', { name: messages.common.switchToLabel });
    expect(link.textContent).toBe('中文');
    // The real href too, for a new tab or a copied link.
    expect(link.getAttribute('href')).toBe('/zh-CN/o/TA-K7M2Q9?t=secret&paid=1');
    fireEvent.click(link);
    expect(goTo).toHaveBeenCalledWith('/zh-CN/o/TA-K7M2Q9?t=secret&paid=1');
  });
});

describe('FindOrderForm', () => {
  const t = messages.public.findOrder;
  const submit = async (email: string) => {
    renderWithIntl(<FindOrderForm />);
    fireEvent.change(screen.getByLabelText(t.email), { target: { value: email } });
    fireEvent.click(await screen.findByRole('button', { name: t.submit }));
  };

  it('says the same thing whatever the address, after sending the human check and language', async () => {
    post.mockResolvedValue({ data: { ok: true }, response: new Response(null, { status: 202 }) });
    await submit(' amy@example.test ');
    expect((await screen.findByRole('status')).textContent).toBe(t.sent);
    expect(post).toHaveBeenCalledWith('/api/v1/public/orders/recover', { body: { email: 'amy@example.test', turnstileToken: 'human', locale: 'en' } });
  });

  it('reports a failed human check and lets them try again', async () => {
    post.mockResolvedValue({ error: { code: 'TURNSTILE_FAILED' }, response: new Response(null, { status: 400 }) });
    await submit('amy@example.test');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('MerchantListings', () => {
  const listing = (over: Partial<PublicMerchant['listings'][number]>): PublicMerchant['listings'][number] => ({
    shortCode: 'abc12345', title: 'Cherries', coverImageUrl: null, type: 'RETAIL', pricing: 'PAID', minPriceCents: 3900, maxPriceCents: 5900,
    availability: 'OPEN', closesAt: null, ...over,
  });

  it('links each listing with its price and whether it still takes orders', () => {
    renderWithIntl(
      <MerchantListings listings={[listing({}), listing({ shortCode: 'yoga0001', title: 'Yoga', pricing: 'FREE', minPriceCents: 0, maxPriceCents: 0, availability: 'SOLD_OUT' })]} />,
    );
    const [cherries, yoga] = screen.getAllByRole('link');
    expect(cherries.getAttribute('href')).toBe('/en/l/abc12345');
    expect(cherries.textContent).toContain('from $39.00');
    expect(cherries.textContent).toContain(messages.public.merchant.open);
    expect(yoga.textContent).toContain(messages.public.listing.free);
    expect(yoga.textContent).toContain(messages.public.listing.state.SOLD_OUT);
  });

  it('says so when there is nothing', () => {
    renderWithIntl(<MerchantListings listings={[]} />);
    expect(screen.getByText(messages.public.merchant.empty)).toBeTruthy();
  });
});
