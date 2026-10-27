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
