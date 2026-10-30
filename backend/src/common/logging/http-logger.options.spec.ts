import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { httpLoggerOptions } from './http-logger.options.js';

async function logOneRequest(path: string, headers: Record<string, string>): Promise<string> {
  let output = '';
  const sink = new Writable({
    write(chunk, _enc, done) {
      output += chunk.toString();
      done();
    },
  });
  const logger = pinoHttp({ ...httpLoggerOptions('production'), level: 'info' }, sink);
  const server: Server = createServer((req, res) => {
    logger(req, res);
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return output;
}

describe('httpLoggerOptions', () => {
  it('never writes session cookies or bearer tokens to the log', async () => {
    const log = await logOneRequest('/api/v1/me', {
      cookie: '__session=secret-session-jwt',
      authorization: 'Bearer secret-bearer-jwt',
    });
    expect(log).toContain('/api/v1/me');
    expect(log).not.toContain('secret-session-jwt');
    expect(log).not.toContain('secret-bearer-jwt');
  });

  it('never writes the order token or idempotency key headers to the log', async () => {
    const log = await logOneRequest('/api/v1/public/orders/TA-7K3Q9P', {
      'x-order-token': 'secret-order-token',
      'idempotency-key': '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    expect(log).toContain('/api/v1/public/orders/TA-7K3Q9P');
    expect(log).not.toContain('secret-order-token');
    expect(log).not.toContain('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
  });

  it('masks the order access token in the URL but keeps the rest of the query', async () => {
    const log = await logOneRequest('/api/v1/public/orders/TA-7K3Q9P?paid=1&t=secret-access-token', {});
    expect(log).not.toContain('secret-access-token');
    expect(log).toContain('/api/v1/public/orders/TA-7K3Q9P?paid=1&t=%5BRedacted%5D');
  });

  it('reuses an incoming x-request-id', async () => {
    const log = await logOneRequest('/api/v1/health', { 'x-request-id': 'req-abc' });
    expect(JSON.parse(log.trim().split('\n')[0]).req.id).toBe('req-abc');
  });
});
