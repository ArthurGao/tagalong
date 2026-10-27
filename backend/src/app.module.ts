import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { httpLoggerOptions } from './common/logging/http-logger.options.js';
import { OriginGuard } from './common/security/origin.guard.js';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';
import { StripeModule } from './modules/stripe/stripe.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: httpLoggerOptions(env.NODE_ENV) }),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    MerchantsModule,
    StripeModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
})
export class AppModule {}
