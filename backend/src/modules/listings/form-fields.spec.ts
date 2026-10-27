import { type FormField, formFieldIssues, sensitiveFieldKeys } from './form-fields.js';

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
