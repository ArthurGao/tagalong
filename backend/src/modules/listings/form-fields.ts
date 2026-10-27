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

// Mirrored by frontend/src/components/public/answers.ts; both test suites run answer-cases.json, so they cannot drift.
const MAX_TEXT: Partial<Record<FormFieldType, number>> = { text: 500, textarea: 2000 };

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

/** Problems with one answer, or null when it is fine. Empty answers are only a problem when required. */
function answerIssue(field: FormField, value: unknown): string | null {
  if (isEmpty(value)) return field.required ? 'required' : null;
  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return 'must be text';
      return value.length > MAX_TEXT[field.type]! ? 'too long' : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'checkbox':
      return value === true ? null : 'must be true or false';
    case 'select':
      return typeof value === 'string' && field.options?.includes(value) ? null : 'not an option';
    case 'multiselect':
      if (!Array.isArray(value)) return 'must be a list';
      return value.every((v) => typeof v === 'string' && field.options?.includes(v)) ? null : 'not an option';
  }
}

function sectionIssues(fields: FormField[], answers: Record<string, unknown>, prefix: string): string[] {
  const issues: string[] = [];
  for (const key of Object.keys(answers)) {
    if (!fields.some((f) => f.key === key)) issues.push(`${prefix}.${key}: unknown field`);
  }
  for (const f of fields) {
    const issue = answerIssue(f, answers[f.key]);
    if (issue) issues.push(`${prefix}.${f.key}: ${issue}`);
  }
  return issues;
}

/**
 * Checks a buyer's answers against the listing's fields (DESIGN §9): order-scope answers once, attendee-scope answers
 * once per place of each item. The backend is the authority; the frontend mirrors these rules for instant feedback.
 */
export function answerIssues(
  fields: FormField[],
  orderAnswers: Record<string, unknown>,
  items: { quantity: number; attendeeAnswers?: Record<string, unknown>[] }[],
): string[] {
  const issues = sectionIssues(fields.filter((f) => f.scope === 'order'), orderAnswers, 'formAnswers');
  const attendeeFields = fields.filter((f) => f.scope === 'attendee');
  items.forEach(({ quantity, attendeeAnswers = [] }, i) => {
    const prefix = `items[${i}].attendeeAnswers`;
    if (!attendeeFields.length) {
      if (attendeeAnswers.length) issues.push(`${prefix}: this listing asks nothing per place`);
      return;
    }
    if (attendeeAnswers.length !== quantity) issues.push(`${prefix}: ${quantity} places need ${quantity} answers`);
    attendeeAnswers.forEach((a, j) => issues.push(...sectionIssues(attendeeFields, a, `${prefix}[${j}]`)));
  });
  return issues;
}
