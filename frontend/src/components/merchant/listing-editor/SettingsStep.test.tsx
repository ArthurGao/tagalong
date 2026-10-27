// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStep } from './SettingsStep';
import { listingFixture, messages, renderWithIntl } from '@/test/render';

const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { PATCH: (...args: unknown[]) => patch(...args) } }));
const f = messages.listings.formFields;

describe('FormFieldBuilder (inside SettingsStep)', () => {
  afterEach(cleanup);

  it('stops at 10 questions', () => {
    renderWithIntl(<SettingsStep listing={listingFixture()} onSaved={() => {}} />);
    const add = screen.getByRole('button', { name: f.add });
    for (let i = 0; i < 10; i++) fireEvent.click(add);
    expect(screen.getAllByLabelText(f.label)).toHaveLength(10);
    expect(add).toHaveProperty('disabled', true);
  });

  it('warns about questions the backend flagged as sensitive', () => {
    const listing = listingFixture({
      formFields: [
        { key: 'passport', label: 'Passport number', type: 'text', required: true, scope: 'attendee' },
        { key: 'age', label: 'Age', type: 'number', required: true, scope: 'attendee' },
      ],
      formFieldWarnings: ['passport'],
    });
    renderWithIntl(<SettingsStep listing={listing} onSaved={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe(f.sensitive.replace('{labels}', 'Passport number'));
  });

  it('never sends a number field it cannot parse', async () => {
    renderWithIntl(<SettingsStep listing={listingFixture()} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(messages.listings.fields.maxQtyPerOrder), { target: { value: 'ten' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await new Promise((r) => setTimeout(r, 50));
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(messages.listings.fields.maxQtyPerOrder), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: messages.listings.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1].body.maxQtyPerOrder).toBe(5);
  });
});
