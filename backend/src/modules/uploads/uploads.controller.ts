import { randomUUID } from 'node:crypto';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { AppError } from '../../common/errors/app-error.js';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { ObjectStorage } from './object-storage.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // DESIGN §9
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
type ImageType = keyof typeof EXTENSIONS;

export class PresignUploadDto {
  @ApiProperty({ enum: Object.keys(EXTENSIONS) })
  @IsIn(Object.keys(EXTENSIONS))
  contentType!: ImageType;

  @ApiProperty({ description: 'File size in bytes; signed into the upload URL', maximum: MAX_IMAGE_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_BYTES)
  contentLength!: number;
}

export class PresignedUploadDto {
  @ApiProperty() uploadUrl!: string;
  @ApiProperty() publicUrl!: string;
}

@ApiTags('uploads')
@Auth('MERCHANT')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: ObjectStorage) {}

  @Post('presign')
  @ApiCreatedResponse({ type: PresignedUploadDto })
  async presign(@CurrentUser() user: AuthUser, @Body() dto: PresignUploadDto): Promise<PresignedUploadDto> {
    const merchantId = requireMerchantId(user);
    if (!this.storage.configured) throw new AppError('BAD_REQUEST', 'Image uploads are not configured');
    const key = this.storage.merchantImageKey(merchantId, `${randomUUID()}.${EXTENSIONS[dto.contentType]}`);
    return this.storage.presignImageUpload(key, dto.contentType, dto.contentLength);
  }
}
