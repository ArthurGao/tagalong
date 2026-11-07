/** A custom-field answer as text: a multi-select reads "a, b". */
export const answerValue = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : String(value));

/**
 * All of one form's answers on one line: "Allergies: nuts · Shirt: M". Each answer goes under its question's label;
 * an answer whose question was deleted since keeps its key.
 */
export const answerText = (answers: Record<string, unknown>, labels: Record<string, string> = {}): string =>
  Object.entries(answers)
    .map(([k, v]) => `${labels[k] ?? k}: ${answerValue(v)}`)
    .join(' · ');
