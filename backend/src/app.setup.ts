import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';

export const API_PREFIX = 'api/v1';

// rawBody: Stripe and Clerk webhooks verify signatures against the raw request body.
export const APP_OPTIONS = { rawBody: true, bufferLogs: true } as const;

// Used by main.ts and the OpenAPI export; e2e tests build from a TestingModule, then call configureApp.
export async function createApp(): Promise<INestApplication> {
  return configureApp(await NestFactory.create(AppModule, APP_OPTIONS));
}

// Shared by every entrypoint so they all see the same prefix, pipes and error filter.
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('TagAlong API').setVersion('1').build();
  return SwaggerModule.createDocument(app, config);
}
