import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, getSchemaPath, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { AppModule } from './app.module.js';
import { API_PREFIX } from './common/api-prefix.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { ErrorBodyDto } from './common/errors/error-body.dto.js';
import { edgeClientIp } from './common/security/edge-client-ip.js';


// rawBody: Stripe and Clerk webhooks verify signatures against the raw request body.
export const APP_OPTIONS = { rawBody: true, bufferLogs: true } as const;

// Used by main.ts and the OpenAPI export; e2e tests build from a TestingModule, then call configureApp.
export async function createApp(): Promise<INestApplication> {
  return configureApp(await NestFactory.create(AppModule, APP_OPTIONS));
}

// Shared by every entrypoint so they all see the same prefix, pipes and error filter.
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  // req.ip from X-Forwarded-For only through trusted hops (rate limits key on it), or from our web app (edge-client-ip.ts).
  const env = app.get<Env>(ENV);
  const trust = env.TRUST_PROXY;
  app.getHttpAdapter().getInstance().set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust);
  app.use(edgeClientIp(env.EDGE_SECRET));
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('TagAlong API').setVersion('1').build();
  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorBodyDto] });
  // Every error goes through AllExceptionsFilter, so every operation can fail with ErrorBodyDto;
  // declaring it once here types `error` for the generated frontend client.
  const errorResponse = {
    description: 'Error (code from DESIGN §17)',
    content: { 'application/json': { schema: { $ref: getSchemaPath(ErrorBodyDto) } } },
  };
  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      if (operation && typeof operation === 'object' && 'responses' in operation) {
        operation.responses.default ??= errorResponse;
      }
    }
  }
  return document;
}
