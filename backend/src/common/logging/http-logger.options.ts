import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Options } from 'pino-http';

const REQUEST_ID_HEADER = 'x-request-id';
// Query parameters that carry bearer-like secrets (order access token, DESIGN §10).
const SECRET_QUERY_PARAMS = ['t'];
const REDACTED = '[Redacted]';

export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let changed = false;
  for (const name of SECRET_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, REDACTED);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}

export function httpLoggerOptions(nodeEnv: string): Options {
  return {
    level: nodeEnv === 'test' ? 'silent' : 'info',
    transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    // Session cookie and bearer token are credentials; never log them.
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], censor: REDACTED },
    serializers: {
      req: (req: { url: string }) => {
        req.url = redactUrl(req.url);
        return req;
      },
    },
    genReqId: (req: IncomingMessage, res) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
  };
}
