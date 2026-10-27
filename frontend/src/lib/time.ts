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

const HOUR = 60 * 60 * 1000;

/**
 * "YYYY-MM-DDTHH:mm" typed as Auckland wall-clock time → UTC ISO string (whatever the browser's zone).
 * Auckland is UTC+12 or +13, so try both offsets and keep the ones that read back as the same wall time:
 * none means the time does not exist (the spring-forward gap) → null; two means the autumn hour that
 * repeats → the earlier instant.
 */
export function nzInputToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const match = [13, 12].map((offset) => asUtc - offset * HOUR).find((t) => isoToNzInput(new Date(t)) === local);
  return match === undefined ? null : new Date(match).toISOString();
}

/** The instant to save for an input: an untouched value keeps its original instant (no DST drift). */
export function instantForInput(original: string | null, input: string): string | null {
  if (original !== null && isoToNzInput(original) === input) return new Date(original).toISOString();
  return nzInputToIso(input);
}
