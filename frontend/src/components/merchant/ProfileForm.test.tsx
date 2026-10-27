// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, renderWithIntl } from '@/test/render';
import { ProfileForm } from './ProfileForm';

// Boundaries: the typed API client and the Next router.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

function fillAndSubmit() {
  renderWithIntl(<ProfileForm defaultEmail="a@example.test" />);
  const f = messages.onboarding.fields;
  fireEvent.change(screen.getByLabelText(f.slug), { target: { value: 'xiaolin-farm' } });
  fireEvent.change(screen.getByLabelText(f.displayName), { target: { value: 'Xiaolin' } });
  fireEvent.change(screen.getByLabelText(f.contactPhone), { target: { value: '021 123 4567' } });
  fireEvent.click(screen.getByRole('button', { name: messages.onboarding.submit }));
}

describe('ProfileForm', () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
  });

  it('shows the fallback error when the request fails at the network level', async () => {
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.errors.INTERNAL);
    expect(screen.getByRole('button', { name: messages.onboarding.submit })).toHaveProperty('disabled', false);
  });

  it('puts SLUG_TAKEN on the slug field', async () => {
    post.mockResolvedValueOnce({ data: undefined, error: { code: 'SLUG_TAKEN', message: 'x' } });
    fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.errors.SLUG_TAKEN);
    expect(screen.getByLabelText(messages.onboarding.fields.slug).getAttribute('aria-invalid')).toBe('true');
  });
});
