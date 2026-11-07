// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { StripeStatusCard } from './StripeStatusCard';

// Boundary: the message catalog behind next-intl's server API.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages: en, namespace: namespace as never, timeZone: 'Pacific/Auckland' }),
}));

const merchant = { stripeConnected: false, chargesEnabled: false, paidListingsEnabled: true };
const card = async (over: Partial<typeof merchant>) => render((await StripeStatusCard({ locale: 'en', merchant: { ...merchant, ...over } }))!);

describe('StripeStatusCard', () => {
  afterEach(cleanup);

  it('asks a merchant to connect Stripe while paid listings are on', async () => {
    await card({});
    expect(screen.getByRole('heading').textContent).toBe(en.stripe.todoTitle);
  });

  it('is not shown at all while the site has paid listings off (DESIGN §13)', async () => {
    expect(await StripeStatusCard({ locale: 'en', merchant: { ...merchant, paidListingsEnabled: false } })).toBeNull();
  });
});
