import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/app.setup.js';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication(APP_OPTIONS));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok under the /api/v1 prefix, naming the deployment and its commit', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', env: 'development', release: '' });
  });

  it('echoes a request id header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'req-123');
    expect(res.headers['x-request-id']).toBe('req-123');
  });

  it('answers unknown routes with the catalog error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('rejects an oversized body with 413 BAD_REQUEST, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  it('is not served without the prefix', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(404);
  });
});
