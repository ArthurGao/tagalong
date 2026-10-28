import { HOUR_MS } from '../../common/time.js';

// RFC 5545 calendar files for event and lesson orders (DESIGN §3, §12): attached to confirmations and reminders, and
// downloadable from the order page. Times are written in UTC, so every calendar shows them in the reader's zone.

/** The file name of an order's calendar, in emails and downloads. */
export const icsFilename = (publicCode: string) => `tagalong-${publicCode}.ics`;

export type CalendarEvent = {
  uid: string;
  title: string;
  /** ISO time. */
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  description: string;
  url: string;
};

/** 20261031T013000Z */
function utc(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n');
}

/** Lines longer than 75 octets continue on the next line after a space (§3.1), never splitting a character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (octets + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function icsCalendar(events: CalendarEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TagAlong//Orders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${utc(e.startsAt)}`,
      `DTEND:${utc(e.endsAt ?? new Date(new Date(e.startsAt).getTime() + HOUR_MS))}`,
      `SUMMARY:${text(e.title)}`,
      ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
      `DESCRIPTION:${text(e.description)}`,
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
