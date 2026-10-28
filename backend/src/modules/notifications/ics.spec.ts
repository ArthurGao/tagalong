import { icsCalendar } from './ics.js';

const event = {
  uid: 'TA-K7M2Q9-opt1@tagalong.nz',
  title: 'Yoga; beginners, all welcome',
  startsAt: '2026-11-07T20:30:00.000Z', // Sunday 8 Nov 09:30 in Auckland (NZDT)
  endsAt: null,
  location: 'Albany Hall\n1 Main St',
  description: 'Order TA-K7M2Q9',
  url: 'https://tagalong.test/zh-CN/o/TA-K7M2Q9?t=abc',
};

describe('.ics calendar (RFC 5545)', () => {
  it('writes one event in UTC with escaped text, CRLF lines and an hour-long default', () => {
    const ics = icsCalendar([event], new Date('2026-10-28T00:00:00Z'));
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TagAlong//Orders//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:TA-K7M2Q9-opt1@tagalong.nz',
      'DTSTAMP:20261028T000000Z',
      'DTSTART:20261107T203000Z',
      'DTEND:20261107T213000Z',
      'SUMMARY:Yoga\\; beginners\\, all welcome',
      'LOCATION:Albany Hall\\n1 Main St',
      'DESCRIPTION:Order TA-K7M2Q9',
      'URL:https://tagalong.test/zh-CN/o/TA-K7M2Q9?t=abc',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('uses the given end and leaves out an unknown location', () => {
    const ics = icsCalendar([{ ...event, endsAt: '2026-11-07T22:00:00.000Z', location: null }]);
    expect(ics).toContain('DTEND:20261107T220000Z\r\n');
    expect(ics).not.toContain('LOCATION');
  });

  it('escapes every kind of line break, so merchant text cannot add calendar lines', () => {
    const ics = icsCalendar([{ ...event, location: 'a\r\nb\rc\nd', title: 'Class\rEND:VEVENT' }]);
    expect(ics).toContain('LOCATION:a\\nb\\nc\\nd\r\n');
    expect(ics).toContain('SUMMARY:Class\\nEND:VEVENT\r\n');
    expect(ics.split('\r\n').filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const ics = icsCalendar([{ ...event, title: '瑜伽课'.repeat(20) }]);
    const lines = ics.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const summary = lines.slice(lines.findIndex((l) => l.startsWith('SUMMARY:')));
    const unfolded = [summary[0], ...summary.slice(1).filter((l) => l.startsWith(' ')).map((l) => l.slice(1))].join('');
    expect(unfolded.startsWith(`SUMMARY:${'瑜伽课'.repeat(20)}`)).toBe(true);
  });
});
