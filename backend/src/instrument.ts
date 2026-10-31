// Imported by main.ts straight after load-env.js, before the app, so errors from start-up on are reported.
import * as Sentry from '@sentry/nestjs';
import { sentryOptions } from './common/observability/sentry.js';
import { parseEnv } from './config/env.js';

const env = parseEnv(process.env);
if (env.SENTRY_DSN) Sentry.init(sentryOptions(env));
