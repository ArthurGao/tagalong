import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { redactUrl, scrubBreadcrumb, scrubEvent, sentryOptions } from './sentry-scrub';

describe('sentry-scrub (DESIGN §10: no order tokens or buyer data in error reports)', () => {
  it('redacts the order token in relative and absolute URLs, keeping the rest', () => {
    expect(redactUrl('/en/o/TA-1?paid=1&t=secret')).toBe('/en/o/TA-1?paid=1&t=%5BRedacted%5D');
    expect(redactUrl('https://tagalong.nz/zh-CN/o/TA-1?t=secret#top')).toBe('https://tagalong.nz/zh-CN/o/TA-1?t=%5BRedacted%5D#top');
    expect(redactUrl('/en/l/abc?ref=wa')).toBe('/en/l/abc?ref=wa');
  });

  it('drops body, cookies and user from events, and redacts navigation breadcrumbs', () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: '/en/o/TA-1?t=secret', query_string: 't=secret', data: { email: 'amy@example.test' }, cookies: { a: 'b' } },
      user: { email: 'amy@example.test' },
    } as ErrorEvent);
    expect(event).toEqual({ type: undefined, request: { url: '/en/o/TA-1?t=%5BRedacted%5D', query_string: 't=%5BRedacted%5D' } });
    expect(scrubBreadcrumb({ category: 'navigation', data: { from: '/en/o/TA-1?t=secret', to: '/en' } }).data).toEqual({ from: '/en/o/TA-1?t=%5BRedacted%5D', to: '/en' });
  });

  it('redacts credential headers and the order token in a Referer, keeping other headers', () => {
    const event = scrubEvent({
      type: undefined,
      request: { headers: { Cookie: '__session=jwt', Authorization: 'Bearer jwt', 'x-order-token': 'tok', Referer: 'https://tagalong.nz/en/o/TA-1?t=secret', 'user-agent': 'UA' } },
    } as ErrorEvent);
    expect(event.request?.headers).toEqual({
      Cookie: '[Redacted]',
      Authorization: '[Redacted]',
      'x-order-token': '[Redacted]',
      Referer: 'https://tagalong.nz/en/o/TA-1?t=%5BRedacted%5D',
      'user-agent': 'UA',
    });
    expect(sentryOptions('dsn', 'production').dataCollection.httpHeaders).toEqual({ deny: ['cookie', 'authorization', 'x-order-token', 'idempotency-key'] });
  });

  it('is off without a DSN and never traces', () => {
    expect(sentryOptions(undefined, undefined)).toMatchObject({ enabled: false, environment: 'development' });
    expect(sentryOptions('dsn', 'production')).not.toHaveProperty('tracesSampleRate'); // setting it, even to 0, turns tracing on
    expect(sentryOptions('https://k@o1.ingest.sentry.io/1', 'production')).toMatchObject({ enabled: true, environment: 'production' });
  });
});
