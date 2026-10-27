import answerCases from './answer-cases.json' with { type: 'json' };
import { answerIssues, type FormField, formFieldIssues, sensitiveFieldKeys } from './form-fields.js';

const field = (over: Partial<FormField> = {}): FormField => ({
  key: 'age',
  label: 'Age',
  type: 'number',
  required: true,
  scope: 'attendee',
  ...over,
});

describe('formFieldIssues', () => {
  it('accepts a valid list', () => {
    expect(formFieldIssues([field(), field({ key: 'size', type: 'select', options: ['S', 'M'] })])).toEqual([]);
  });

  it('caps the list at 10 fields', () => {
    const many = Array.from({ length: 11 }, (_, i) => field({ key: `f${i}` }));
    expect(formFieldIssues(many)).toContain('formFields: at most 10 fields');
  });

  it('requires unique keys and options for select types', () => {
    expect(formFieldIssues([field(), field()])).toContain('formFields: duplicate key "age"');
    expect(formFieldIssues([field({ key: 'size', type: 'multiselect', options: [] })])).toContain(
      'formFields.size: select fields need options',
    );
  });
});

describe('sensitiveFieldKeys (DESIGN §10: warn, never block)', () => {
  it('flags labels asking for passports, IRD numbers or bank details, in English or Chinese', () => {
    const fields = [
      field({ key: 'a', label: 'Passport number' }),
      field({ key: 'b', label: 'IRD' }),
      field({ key: 'c', label: '银行卡号' }),
      field({ key: 'd', label: '护照' }),
      field({ key: 'e', label: 'Bank account' }),
      field({ key: 'f', label: 'Child name' }),
    ];
    expect(sensitiveFieldKeys(fields)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('answerIssues (DESIGN §9: required, type, valid options, one answer per place)', () => {
  const fields: FormField[] = [
    { key: 'allergies', label: 'Allergies', type: 'text', required: false, scope: 'order' },
    { key: 'size', label: 'Size', type: 'select', required: true, scope: 'order', options: ['S', 'M'] },
    { key: 'agree', label: 'I agree', type: 'checkbox', required: true, scope: 'order' },
    { key: 'child_age', label: 'Age', type: 'number', required: true, scope: 'attendee' },
    { key: 'extras', label: 'Extras', type: 'multiselect', required: false, scope: 'attendee', options: ['Milk', 'Tea'] },
  ];
  const order = { size: 'M', agree: true };
  const two = [{ quantity: 2, attendeeAnswers: [{ child_age: 6 }, { child_age: 8, extras: ['Tea'] }] }];

  it('accepts complete, well-typed answers (attendee fields once per place of each item)', () => {
    expect(answerIssues(fields, order, two)).toEqual([]);
  });

  it.each([
    ['a missing required field', { agree: true }, two, 'formAnswers.size: required'],
    ['a key the merchant never asked', { ...order, passport: 'x' }, two, 'formAnswers.passport: unknown field'],
    ['an unchecked required checkbox', { size: 'S', agree: false }, two, 'formAnswers.agree: required'],
    ['too few answers for an item', order, [{ quantity: 2, attendeeAnswers: [{ child_age: 6 }] }], 'items[0].attendeeAnswers: 2 places need 2 answers'],
    ['answers spread across items', order, [{ quantity: 1, attendeeAnswers: [{ child_age: 6 }, { child_age: 7 }] }, { quantity: 1 }], 'items[1].attendeeAnswers: 1 places need 1 answers'],
    ['a bad attendee answer', order, [{ quantity: 1, attendeeAnswers: [{ child_age: 'six' }] }], 'items[0].attendeeAnswers[0].child_age: must be a number'],
  ])('rejects %s', (_, orderAnswers, items, issue) => {
    expect(answerIssues(fields, orderAnswers, items)).toContain(issue);
  });

  it('needs no attendee answers when there are no attendee fields, and refuses them', () => {
    const orderOnly = fields.filter((f) => f.scope === 'order');
    expect(answerIssues(orderOnly, order, [{ quantity: 3 }])).toEqual([]);
    expect(answerIssues(orderOnly, order, [{ quantity: 1, attendeeAnswers: [{}] }])).toEqual(['items[0].attendeeAnswers: this listing asks nothing per place']);
  });

  // The same table runs in frontend answers.test.ts, so the two implementations cannot drift apart.
  it.each(answerCases as { field: FormField; value?: unknown; repeat?: number; ok: boolean; why: string }[])('shared case: $why', (c) => {
    const value = c.repeat ? 'x'.repeat(c.repeat) : c.value;
    expect(answerIssues([c.field], { [c.field.key]: value }, []).length === 0).toBe(c.ok);
  });
});
