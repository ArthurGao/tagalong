import './load-env.js';
import 'reflect-metadata';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApiDocument, createApp } from './app.setup.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
}

void bootstrap();
