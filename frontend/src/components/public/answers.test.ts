import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { answerProblems, cleanAnswers, type FormField } from './answers';

const fields: FormField[] = [
  { key: 'diet', label: 'Diet', type: 'select', required: true, scope: 'order', options: ['Vegan', 'Any'] },
  { key: 'agree', label: 'Agree', type: 'checkbox', required: true, scope: 'order' },
  { key: 'notes', label: 'Notes', type: 'text', required: false, scope: 'order' },
  { key: 'extras', label: 'Extras', type: 'multiselect', required: false, scope: 'order', options: ['Milk'] },
];

describe('answers (mirrors backend answerIssues)', () => {
  it('flags missing required answers and values that are not offered', () => {
    expect(answerProblems(fields, {})).toEqual({ diet: 'required', agree: 'required' });
    expect(answerProblems(fields, { diet: 'Meat', agree: true, extras: ['Beer'] })).toEqual({ diet: 'invalid', extras: 'invalid' });
    expect(answerProblems(fields, { diet: 'Vegan', agree: true, notes: 'x'.repeat(501) })).toEqual({ notes: 'invalid' });
    expect(answerProblems(fields, { diet: 'Vegan', agree: true })).toEqual({});
  });

  it('sends only the asked keys, without empty answers', () => {
    expect(cleanAnswers(fields, { diet: 'Vegan', agree: true, notes: '', extras: [], stray: 'x' })).toEqual({ diet: 'Vegan', agree: true });
  });
});

// The backend runs the same table (form-fields.spec.ts): this is what keeps the two implementations equal.
const cases = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../backend/src/modules/listings/answer-cases.json', import.meta.url)), 'utf8'),
) as { field: FormField; value?: unknown; repeat?: number; ok: boolean; why: string }[];

describe('shared answer cases', () => {
  it.each(cases)('$why', (c) => {
    const value = c.repeat ? 'x'.repeat(c.repeat) : c.value;
    expect(Object.keys(answerProblems([c.field], { [c.field.key]: value })).length === 0).toBe(c.ok);
  });
});
