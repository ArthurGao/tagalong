import { ObjectStorage, type PresignedUpload } from '../../../src/modules/uploads/object-storage.js';

export class FakeObjectStorage extends ObjectStorage {
  readonly configured = true;
  readonly publicBaseUrl = 'https://img.tagalong.test';
  readonly presigned: { key: string; contentType: string; contentLength: number }[] = [];

  async presignImageUpload(key: string, contentType: string, contentLength: number): Promise<PresignedUpload> {
    this.presigned.push({ key, contentType, contentLength });
    return { uploadUrl: `https://upload.tagalong.test/${key}?signed`, publicUrl: `${this.publicBaseUrl}/${key}` };
  }
}
