import { Module } from '@nestjs/common';
import { ObjectStorage, S3ObjectStorage } from './object-storage.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  controllers: [UploadsController],
  providers: [{ provide: ObjectStorage, useClass: S3ObjectStorage }],
  exports: [ObjectStorage],
})
export class UploadsModule {}
