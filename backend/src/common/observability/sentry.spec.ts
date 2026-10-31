import type { ErrorEvent } from '@sentry/nestjs';
import { scrubBreadcrumb, scrubEvent, sentryOptions } from './sentry.js';

describe('Sentry scrubbing (DESIGN §10: no credentials or buyer data in error reports)', () => {
  it('redacts secret headers, drops cookies, body and user, and redacts the order token in the URL and query', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://api.tagalong.nz/api/v1/public/orders/TA-1?paid=1&t=secret-token',
        query_string: 'paid=1&t=secret-token',
        headers: { Cookie: '__session=jwt', authorization: 'Bearer jwt', 'X-Order-Token': 'tok', 'Idempotency-Key': 'key', Referer: 'https://tagalong.nz/en/o/TA-1?t=secret-token', 'user-agent': 'UA' },
        cookies: { __session: 'jwt' },
        data: { buyer: { email: 'amy@example.test' } },
      },
      user: { email: 'amy@example.test', ip_address: '1.2.3.4' },
    } as ErrorEvent);
    expect(event.request).toEqual({
      url: 'https://api.tagalong.nz/api/v1/public/orders/TA-1?paid=1&t=%5BRedacted%5D',
      query_string: 'paid=1&t=%5BRedacted%5D',
      headers: {
        Cookie: '[Redacted]',
        authorization: '[Redacted]',
        'X-Order-Token': '[Redacted]',
        'Idempotency-Key': '[Redacted]',
        Referer: 'https://tagalong.nz/en/o/TA-1?t=%5BRedacted%5D',
        'user-agent': 'UA',
      },
    });
    expect(event.user).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/secret-token|jwt|amy@/);
  });

  it('redacts emails, phone numbers and order tokens quoted in error messages and breadcrumbs', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'refund for amy@example.test failed',
      exception: { values: [{ type: 'PrismaClientKnownRequestError', value: 'Key (buyer_email)=(Amy.Lee@Example.test) already exists; phone +64 21 555 0101; /o/TA-1?t=secret-token' }] },
      request: { headers: { 'x-tagalong-edge': 'edge-secret', 'x-tagalong-client-ip': '203.0.113.7' } },
    } as ErrorEvent);
    expect(event.exception!.values![0].value).toBe('Key (buyer_email)=([email]) already exists; phone [number]; /o/TA-1?t=%5BRedacted%5D');
    expect(event.exception!.values![0].type).toBe('PrismaClientKnownRequestError');
    expect(event.message).toBe('refund for [email] failed');
    expect(event.request!.headers).toEqual({ 'x-tagalong-edge': '[Redacted]', 'x-tagalong-client-ip': '[Redacted]' });
    expect(scrubBreadcrumb({ category: 'console', message: 'sent to ben@example.test' }).message).toBe('sent to [email]');
  });

  it('collects no user, cookies or bodies, and no traces', () => {
    const options = sentryOptions({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', APP_ENV: 'staging', RENDER_GIT_COMMIT: 'abc123' });
    expect(options).toMatchObject({ environment: 'staging', release: 'abc123', dataCollection: { userInfo: false, cookies: false, httpBodies: [] } });
    expect(options).not.toHaveProperty('tracesSampleRate'); // setting it, even to 0, turns tracing on
    expect(options.beforeSend).toBe(scrubEvent);
  });
});
