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

const inputParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: NZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** UTC instant → "YYYY-MM-DDTHH:mm" in Auckland, the value a datetime-local input shows ('' for none). */
export function isoToNzInput(iso: string | Date | null): string {
  if (iso === null) return '';
  const parts = Object.fromEntries(inputParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "YYYY-MM-DDTHH:mm" typed as Auckland wall-clock time → UTC ISO string (whatever the browser's zone). */
export function nzInputToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Auckland's offset at that moment; the second pass settles instants near a DST switch.
  const offsetAt = (t: number) => Date.parse(`${isoToNzInput(new Date(t))}:00Z`) - t;
  let utc = asUtc - offsetAt(asUtc);
  utc = asUtc - offsetAt(utc);
  return new Date(utc).toISOString();
}
