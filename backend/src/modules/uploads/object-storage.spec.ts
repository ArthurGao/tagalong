import { parseEnv } from '../../config/env.js';
import { S3ObjectStorage } from './object-storage.js';

const env = (over: Record<string, string> = {}) =>
  parseEnv({
    APP_URL: 'http://localhost:3800',
    DATABASE_URL: 'postgresql://x@localhost:5442/x',
    S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
    S3_BUCKET: 'tagalong-images',
    S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_PUBLIC_BASE_URL: 'https://img.tagalong.nz/',
    ...over,
  });

describe('S3ObjectStorage', () => {
  it('signs a PUT that pins both Content-Type and Content-Length (the size limit)', async () => {
    const storage = new S3ObjectStorage(env());
    const { uploadUrl, publicUrl } = await storage.presignImageUpload('listings/m1/a.webp', 'image/webp', 120_000);
    const url = new URL(uploadUrl);
    expect(url.host).toBe('tagalong-images.acc.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/listings/m1/a.webp');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    );
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
    expect(publicUrl).toBe('https://img.tagalong.nz/listings/m1/a.webp');
  });

  it('reports unconfigured storage so the API can refuse uploads', () => {
    expect(new S3ObjectStorage(env({ S3_BUCKET: '' })).configured).toBe(false);
    expect(new S3ObjectStorage(env()).configured).toBe(true);
  });
});
