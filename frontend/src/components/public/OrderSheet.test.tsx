// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, publicListingFixture, renderLive } from '@/test/render';
import type { PublicListing } from '@/lib/api/public';
import { OrderSheet } from './OrderSheet';

// Boundaries: the API client, the public fetchers (refresh) and full-page navigation.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
const fetchPublicListing = vi.fn();
vi.mock('@/lib/api/public', () => ({
  fetchPublicListing: (...args: unknown[]) => fetchPublicListing(...args),
  fetchParticipants: vi.fn(),
}));
const goTo = vi.fn();
vi.mock('@/lib/navigate', () => ({ goTo: (url: string) => goTo(url) }));
// Cloudflare's widget is a third-party boundary: it hands over a token as soon as it mounts.
let turnstileMounts = 0;
vi.mock('./Turnstile', async () => {
  const { useEffect } = await import('react');
  return {
    Turnstile: ({ onToken }: { onToken: (token: string) => void }) => {
      useEffect(() => {
        turnstileMounts++;
        onToken(`token-${turnstileMounts}`);
      }, [onToken]);
      return null;
    },
  };
});

const t = messages.public.checkout;
const option = (id: string, name: string, priceCents: number, remaining: number | null) => ({
  id,
  name,
  priceCents,
  remaining,
  startsAt: null,
  endsAt: null,
  location: null,
});
const listing = (over: Partial<PublicListing> = {}) =>
  publicListingFixture({
    maxQtyPerOrder: 3,
    options: [option('opt-a', '2kg', 3900, 2), option('opt-b', '5kg', 8900, null)],
    pickupPoints: [
      { id: 'pp-1', label: 'Albany', address: '1 Main St', windowStart: null, windowEnd: null, notes: null },
      { id: 'pp-2', label: 'Ponsonby', address: '2 High St', windowStart: null, windowEnd: null, notes: null },
    ],
    ...over,
  });

const plus = (name: string) => screen.getByRole('button', { name: t.increase.replace('{name}', name) });
const fillBuyer = () => {
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Amy Lee' } });
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'amy@example.test' } });
  fireEvent.change(screen.getByLabelText(t.phone), { target: { value: '021 555 0101' } });
  fireEvent.change(screen.getByLabelText(t.pickup), { target: { value: 'pp-2' } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: t.pay }));

describe('OrderSheet', () => {
  afterEach(() => {
    cleanup();
    turnstileMounts = 0;
    post.mockReset();
    goTo.mockReset();
    fetchPublicListing.mockReset();
  });

  it('caps each option at its places left and the whole order at maxQtyPerOrder', () => {
    renderLive(<OrderSheet open onOpenChange={() => {}} />, listing());
    fireEvent.click(plus('2kg'));
    fireEvent.click(plus('2kg'));
    expect(plus('2kg')).toHaveProperty('disabled', true); // 2 left
    fireEvent.click(plus('5kg'));
    expect(plus('5kg')).toHaveProperty('disabled', true); // 3 per order
    expect(screen.getByText(t.subtotal.replace('{amount}', '$167.00'))).toBeTruthy();
  });

  it('sends ids and quantities only, with an Idempotency-Key, then goes to Stripe Checkout', async () => {
    post.mockResolvedValue({ data: { kind: 'checkout', checkoutUrl: 'https://checkout.stripe.test/cs_1' } });
    renderLive(<OrderSheet open onOpenChange={() => {}} />, listing());
    fireEvent.click(plus('5kg'));
    fillBuyer();
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1'));
    const [path, init] = post.mock.calls[0];
    expect(path).toBe('/api/v1/public/listings/{shortCode}/orders');
    expect(init.params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.body).toEqual({
      items: [{ optionId: 'opt-b', quantity: 1 }],
      buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' },
      pickupPointId: 'pp-2',
      anonymous: false,
      locale: 'en',
      turnstileToken: expect.stringMatching(/^token-/),
    });
  });

  it('reuses the same Idempotency-Key when the buyer retries after a failure', async () => {
    post
      .mockResolvedValueOnce({ error: { code: 'STRIPE_ERROR', message: 'x' } })
      .mockResolvedValueOnce({ data: { kind: 'checkout', checkoutUrl: 'https://checkout.stripe.test/cs_2' } });
    renderLive(<OrderSheet open onOpenChange={() => {}} />, listing());
    fireEvent.click(plus('5kg'));
    fillBuyer();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(messages.errors.STRIPE_ERROR);
    // The used token is dropped and the widget remounts; retry once the fresh token is in.
    await waitFor(() => expect(turnstileMounts).toBe(2));
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    const keys = post.mock.calls.map(([, init]) => init.params.header['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    // Turnstile tokens are single-use: the retry carries a fresh one.
    const tokens = post.mock.calls.map(([, init]) => init.body.turnstileToken);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('on SOLD_OUT, says so and refreshes the places left', async () => {
    post.mockResolvedValue({ error: { code: 'SOLD_OUT', message: 'x' } });
    fetchPublicListing.mockResolvedValue(listing({ options: [option('opt-a', '2kg', 3900, 0), option('opt-b', '5kg', 8900, null)] }));
    renderLive(<OrderSheet open onOpenChange={() => {}} />, listing());
    fireEvent.click(plus('2kg'));
    fillBuyer();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(t.soldOutRefreshed);
    await waitFor(() => expect(fetchPublicListing).toHaveBeenCalledWith('abcd2345'));
    expect(goTo).not.toHaveBeenCalled();
  });

  it('asks for an item, a pickup point and valid details before sending anything', async () => {
    renderLive(<OrderSheet open onOpenChange={() => {}} />, listing());
    submit();
    expect(await screen.findByText(t.validation.email)).toBeTruthy();
    fillBuyer();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(t.validation.items);
    expect(post).not.toHaveBeenCalled();
  });

  it('renders inside the page surface, so the surface colours and fonts apply to the dialog', () => {
    renderLive(
      <div data-surface="public">
        <OrderSheet open onOpenChange={() => {}} />
      </div>,
      listing(),
    );
    expect(screen.getByRole('dialog').closest('[data-surface]')?.getAttribute('data-surface')).toBe('public');
  });

  describe('free registration', () => {
    const free = (over: Partial<PublicListing> = {}) =>
      listing({ pricing: 'FREE', maxQtyPerOrder: 2, options: [option('opt-a', 'Sat 9am', 0, 10)], pickupPoints: [], ...over });
    const fillName = () => {
      fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Amy Lee' } });
      fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'amy@example.test' } });
      fireEvent.change(screen.getByLabelText(t.phone), { target: { value: '021 555 0101' } });
    };

    it('registers without prices and goes straight to the registration page', async () => {
      post.mockResolvedValue({ data: { kind: 'confirmed', publicCode: 'TA-K7M2Q9', accessToken: 'tok en' } });
      renderLive(<OrderSheet open onOpenChange={() => {}} />, free());
      expect(screen.queryByText(/\$/)).toBeNull();
      fillName();
      fireEvent.click(screen.getByRole('button', { name: t.register }));
      await waitFor(() => expect(goTo).toHaveBeenCalledWith('/en/o/TA-K7M2Q9?t=tok%20en'));
    });

    it('asks the custom questions, attendee ones once per place, and sends them', async () => {
      post.mockResolvedValue({ data: { kind: 'confirmed', publicCode: 'TA-1', accessToken: 't' } });
      const formFields = [
        { key: 'diet', label: 'Diet', type: 'select' as const, required: true, scope: 'order' as const, options: ['Vegan', 'Any'] },
        { key: 'age', label: 'Age', type: 'number' as const, required: true, scope: 'attendee' as const },
      ];
      renderLive(<OrderSheet open onOpenChange={() => {}} />, free({ formFields }));
      fireEvent.click(plus('Sat 9am')); // 2 places
      fillName();
      fireEvent.click(screen.getByRole('button', { name: t.register }));
      expect((await screen.findByRole('alert')).textContent).toBe(t.validation.answers);
      expect(post).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Diet (required)'), { target: { value: 'Vegan' } });
      const ages = screen.getAllByLabelText('Age (required)');
      expect(ages).toHaveLength(2);
      fireEvent.change(ages[0], { target: { value: '7' } });
      fireEvent.change(ages[1], { target: { value: '9' } });
      fireEvent.click(screen.getByRole('button', { name: t.register }));
      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(post.mock.calls[0][1].body).toMatchObject({
        formAnswers: { diet: 'Vegan' },
        items: [{ optionId: 'opt-a', quantity: 2, attendeeAnswers: [{ age: 7 }, { age: 9 }] }],
      });
    });

    it('says when the email is already registered', async () => {
      post.mockResolvedValue({ error: { code: 'ALREADY_REGISTERED', message: 'x' } });
      renderLive(<OrderSheet open onOpenChange={() => {}} />, free());
      fillName();
      fireEvent.click(screen.getByRole('button', { name: t.register }));
      expect((await screen.findByRole('alert')).textContent).toBe(messages.errors.ALREADY_REGISTERED);
      expect(goTo).not.toHaveBeenCalled();
    });
  });
});
