// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { StripeOnboardButton } from './StripeButtons';

// Network boundary: the typed API client.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));

const renderButton = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StripeOnboardButton label="start" />
    </NextIntlClientProvider>,
  );

describe('StripeOnboardButton', () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
  });

  it('recovers from a network failure: shows the fallback error and can be retried', async () => {
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: messages.stripe.start }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.errors.INTERNAL);
    const button = screen.getByRole('button', { name: messages.stripe.start });
    expect(button).toHaveProperty('disabled', false);
  });

  it('shows the translated API error and re-enables the button', async () => {
    post.mockResolvedValueOnce({ data: undefined, error: { code: 'MERCHANT_SUSPENDED', message: 'x' } });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: messages.stripe.start }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.errors.MERCHANT_SUSPENDED);
    expect(screen.getByRole('button', { name: messages.stripe.start })).toHaveProperty('disabled', false);
  });
});
