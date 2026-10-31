import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Options } from 'pino-http';
import { REDACTED, redactUrl, SECRET_HEADERS } from './redact.js';

const REQUEST_ID_HEADER = 'x-request-id';
export function httpLoggerOptions(nodeEnv: string): Options {
  return {
    level: nodeEnv === 'test' ? 'silent' : 'info',
    transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    // Credentials never reach the log (redact.ts).
    redact: { paths: SECRET_HEADERS.map((h) => `req.headers["${h}"]`), censor: REDACTED },
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
