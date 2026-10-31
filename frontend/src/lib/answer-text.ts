/** A custom-field answer as text: a multi-select reads "a, b". */
export const answerValue = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : String(value));

/** All of one form's answers on one line: "Allergies: nuts · Shirt: M". */
export const answerText = (answers: Record<string, unknown>): string =>
  Object.entries(answers)
    .map(([k, v]) => `${k}: ${answerValue(v)}`)
    .join(' · ');
