import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/** File names the upload endpoint issues: a random UUID and the extension for the declared type. */
const ISSUED_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export interface PresignedUpload {
  /** PUT the file here with the same Content-Type; the browser sends the signed Content-Length. */
  uploadUrl: string;
  publicUrl: string;
}

// S3 or Cloudflare R2 behind one token; e2e tests swap in a fake. The key layout lives here too, so the
// upload endpoint and the listing image check cannot disagree.
export abstract class ObjectStorage {
  abstract readonly configured: boolean;
  abstract readonly publicBaseUrl: string;
  abstract presignImageUpload(key: string, contentType: string, contentLength: number): Promise<PresignedUpload>;

  merchantImageKey(merchantId: string, fileName: string): string {
    return `listings/${merchantId}/${fileName}`;
  }

  /**
   * True only for a URL of an image this storage issued to the merchant: same origin as the public base,
   * no query or fragment, and a path (after URL normalisation, so "../" cannot escape) of exactly
   * <base path>/listings/{merchantId}/{uuid}.{jpg|png|webp}.
   */
  isMerchantImage(url: string, merchantId: string): boolean {
    if (!this.configured) return false;
    let parsed: URL;
    let base: URL;
    try {
      parsed = new URL(url);
      base = new URL(this.publicBaseUrl);
    } catch {
      return false;
    }
    if (parsed.origin !== base.origin || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    const folder = `${base.pathname.replace(/\/$/, '')}/${this.merchantImageKey(merchantId, '')}`;
    if (!parsed.pathname.startsWith(folder)) return false;
    return ISSUED_FILE_NAME.test(parsed.pathname.slice(folder.length));
  }
}

@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  readonly configured: boolean;
  readonly publicBaseUrl: string;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    super();
    this.configured = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_PUBLIC_BASE_URL);
    this.publicBaseUrl = env.S3_PUBLIC_BASE_URL.replace(/\/$/, '');
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: 'auto', // R2; S3 ignores it when an endpoint is set
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  // A presigned PUT with Content-Length in the signature: R2 has no POST policies, and signing the length
  // is what enforces the size limit (a different body size fails the signature check).
  async presignImageUpload(key: string, contentType: string, contentLength: number): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 300,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { uploadUrl, publicUrl: `${this.publicBaseUrl}/${key}` };
  }
}
