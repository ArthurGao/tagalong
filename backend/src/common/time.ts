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

const wallClock = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** Auckland wall-clock fields of an instant. */
function aucklandParts(at: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const parts = Object.fromEntries(wallClock.formatToParts(at).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/** How far Auckland's clock is ahead of UTC at an instant (12 or 13 hours). */
function aucklandOffsetMs(at: Date): number {
  const p = aucklandParts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * When the Auckland calendar day containing `at` began (local midnight), for "today" figures; with `daysBack`, the
 * midnight that many calendar days earlier (not 24-hour steps: a clock change in between moves it by an hour).
 */
export function aucklandDayStart(at: Date, daysBack = 0): Date {
  const { year, month, day } = aucklandParts(at);
  const midnightAsUtc = Date.UTC(year, month - 1, day - daysBack);
  // Clocks change at 02:00/03:00, never at midnight: the offset found near midnight is the one at midnight.
  const near = midnightAsUtc - aucklandOffsetMs(at);
  return new Date(midnightAsUtc - aucklandOffsetMs(new Date(near)));
}
