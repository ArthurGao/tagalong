import type { Prisma } from '../../generated/prisma/client.js';

// Merchant-defined sign-up fields (DESIGN §5.1 Listing.formFields). Answers are PII.
export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'multiselect', 'checkbox'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** order: answered once per order; attendee: once per place (e.g. each child's age). */
  scope: 'order' | 'attendee';
  options?: string[];
}

export const MAX_FORM_FIELDS = 10;

export function formFieldIssues(fields: FormField[]): string[] {
  const issues: string[] = [];
  if (fields.length > MAX_FORM_FIELDS) issues.push(`formFields: at most ${MAX_FORM_FIELDS} fields`);
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) issues.push(`formFields: duplicate key "${f.key}"`);
    seen.add(f.key);
    if ((f.type === 'select' || f.type === 'multiselect') && !f.options?.length) {
      issues.push(`formFields.${f.key}: select fields need options`);
    }
  }
  return issues;
}

// DESIGN §10: collect only what the event needs. Matching labels get a warning, never a block.
const SENSITIVE = /passport|\bird\b|bank|credit card|护照|身份证|卡号|银行/i;

export const sensitiveFieldKeys = (fields: FormField[]): string[] =>
  fields.filter((f) => SENSITIVE.test(f.label)).map((f) => f.key);

// Listing.formFields is a Json column; these two are the only places that cross that boundary.
export const readFormFields = (json: Prisma.JsonValue): FormField[] => json as unknown as FormField[];
export const toFormFieldsJson = (fields: FormField[]): Prisma.InputJsonValue => fields as unknown as Prisma.InputJsonValue;
