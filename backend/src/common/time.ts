// Times are stored in UTC and shown in Auckland time (root CLAUDE.md rule 2); mirrors frontend lib/time.ts.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
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
