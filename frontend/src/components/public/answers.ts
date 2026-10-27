import type { components } from '@/lib/api/schema';

export type FormField = components['schemas']['FormFieldDto'];
export type Answers = Record<string, unknown>;
export type AnswerProblem = 'required' | 'invalid';

const MAX_TEXT: Partial<Record<FormField['type'], number>> = { text: 500, textarea: 2000 };

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

// Mirrors backend form-fields.ts answerIssues() for instant feedback; the backend stays the authority. Both test
// suites run backend/src/modules/listings/answer-cases.json, so the two cannot drift apart.
function problem(field: FormField, value: unknown): AnswerProblem | null {
  if (isEmpty(value)) return field.required ? 'required' : null;
  switch (field.type) {
    case 'text':
    case 'textarea':
      return typeof value === 'string' && value.length <= MAX_TEXT[field.type]! ? null : 'invalid';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'invalid';
    case 'checkbox':
      return value === true ? null : 'invalid';
    case 'select':
      return typeof value === 'string' && field.options?.includes(value) ? null : 'invalid';
    case 'multiselect':
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && field.options?.includes(v)) ? null : 'invalid';
  }
}

/** Problems by field key for one set of answers (order scope, or one attendee). */
export function answerProblems(fields: FormField[], answers: Answers): Record<string, AnswerProblem> {
  const out: Record<string, AnswerProblem> = {};
  for (const f of fields) {
    const p = problem(f, answers[f.key]);
    if (p) out[f.key] = p;
  }
  return out;
}

/** Only the keys the merchant asked for, with empty answers dropped (the backend refuses unknown keys). */
export function cleanAnswers(fields: FormField[], answers: Answers): Answers {
  return Object.fromEntries(
    fields.flatMap((f) => (isEmpty(answers[f.key]) ? [] : [[f.key, answers[f.key]]])),
  );
}
