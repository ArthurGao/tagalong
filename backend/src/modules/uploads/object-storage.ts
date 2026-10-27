import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

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

  /** True for a URL this storage serves from the merchant's own image folder. */
  isMerchantImage(url: string, merchantId: string): boolean {
    return this.configured && url.startsWith(`${this.publicBaseUrl}/${this.merchantImageKey(merchantId, '')}`);
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
