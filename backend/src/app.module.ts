import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { httpLoggerOptions } from './common/logging/http-logger.options.js';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: httpLoggerOptions(env.NODE_ENV) }),
    }),
    HealthModule,
  ],
})
export class AppModule {}
