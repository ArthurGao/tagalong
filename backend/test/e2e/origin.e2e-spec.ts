import { Controller, Get, Post } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/app.js';

@Controller('probe')
class ProbeController {
  @Post()
  write() {
    return { ok: true };
  }

  @Get()
  read() {
    return { ok: true };
  }
}

@Controller('public/probe')
class PublicProbeController {
  @Post()
  write() {
    return { ok: true };
  }
}

// APP_URL=http://localhost:3800 in vitest.config.ts is the allowed origin.
describe('Origin check on unsafe requests (CSRF defence, DESIGN §9)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp([ProbeController, PublicProbeController]);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('rejects a cookie-carrying POST from a foreign origin', async () => {
    const res = await http().post('/api/v1/probe').set('cookie', '__session=x').set('origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('rejects a cookie-carrying POST without an Origin header', async () => {
    expect((await http().post('/api/v1/probe').set('cookie', '__session=x')).status).toBe(403);
  });

  it('accepts a cookie-carrying POST from the app origin', async () => {
    const res = await http().post('/api/v1/probe').set('cookie', '__session=x').set('origin', 'http://localhost:3800');
    expect(res.status).toBe(201);
  });

  it('lets cookie-less callers (Bearer clients, webhooks) through without an Origin', async () => {
    expect((await http().post('/api/v1/probe').set('authorization', 'Bearer x')).status).toBe(201);
  });

  it('requires the app origin on public writes even without a cookie', async () => {
    expect((await http().post('/api/v1/public/probe')).status).toBe(403);
    expect((await http().post('/api/v1/public/probe').set('origin', 'http://localhost:3800')).status).toBe(201);
  });

  it('never blocks safe methods', async () => {
    const res = await http().get('/api/v1/probe').set('cookie', '__session=x').set('origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});
