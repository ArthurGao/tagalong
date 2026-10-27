import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiDocument, createApp } from './app.setup.js';

// Writes the OpenAPI spec for `pnpm gen:api`; needs no database or secrets, so required
// variables get placeholders and NODE_ENV=test silences the logger.
process.env.APP_URL ??= 'http://localhost:3800';
process.env.DATABASE_URL ??= 'postgresql://localhost:5442/unused';
process.env.NODE_ENV = 'test';

const app = await createApp();
const target = resolve(import.meta.dirname, '../../frontend/openapi.json');
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
await app.close();
console.log(`OpenAPI spec written to ${target}`);
