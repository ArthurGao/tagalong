// Times are stored in UTC and shown in Auckland time (root CLAUDE.md rule 2); mirrors frontend lib/time.ts.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** The UTC clock hour of `at` ("2026-10-28T13"), for per-hour dedupe keys, and when it began. */
export function utcHour(at: Date): { key: string; start: Date } {
  const key = at.toISOString().slice(0, 13);
  return { key, start: new Date(`${key}:00:00.000Z`) };
}
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatNzDateTime(value: Date | string, locale: string): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-NZ' : 'zh-CN', {
      timeZone: 'Pacific/Auckland',
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(typeof value === 'string' ? new Date(value) : value);
}
