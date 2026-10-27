export const NZ_TIME_ZONE = 'Pacific/Auckland';

const formatters = new Map<string, Intl.DateTimeFormat>();

// Times are stored in UTC and always shown in Auckland time (DESIGN D9).
export function formatNzDateTime(value: Date | string, locale: string): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-NZ' : locale, {
      timeZone: NZ_TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(typeof value === 'string' ? new Date(value) : value);
}
