// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishStep } from './PublishStep';
import { listingFixture, messages, renderWithIntl } from '@/test/render';

// Network boundary: the typed API client.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
const m = messages.listings.missing;

describe('PublishStep', () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
  });

  it('names every item the backend says is missing, including option start times', async () => {
    post.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'VALIDATION_FAILED', message: 'x', details: ['policyText', 'options.startsAt', 'pickupPoints'] },
    });
    renderWithIntl(<PublishStep listing={listingFixture({ type: 'SESSION' })} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: messages.listings.publish.publish }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain([m.policyText, m.optionsStartsAt, m.pickupPoints].join(', '));
  });
});
