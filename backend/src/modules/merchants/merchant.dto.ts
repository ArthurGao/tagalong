import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import { MerchantStatus } from '../../generated/prisma/enums.js';

// 3–30 chars, lowercase letters, digits and inner hyphens: it becomes the public /m/{slug} link.
const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
// NZ GST numbers are 8 or 9 digits, often written 123-456-789.
const GST = /^\d{2,3}-?\d{3}-?\d{3}$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

export class CreateMerchantDto {
  @ApiProperty({ example: 'xiaolin-farm' })
  @Matches(SLUG, { message: 'slug must be 3-30 lowercase letters, digits or inner hyphens' })
  slug!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 60)
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string;

  @ApiProperty()
  @IsEmail()
  contactEmail!: string;

  @ApiProperty({ example: '+64 21 123 4567' })
  @Matches(PHONE, { message: 'contactPhone must be a phone number' })
  contactPhone!: string;

  @ApiPropertyOptional({ example: '123-456-789' })
  @IsOptional()
  @Matches(GST, { message: 'gstNumber must be an NZ GST number' })
  gstNumber?: string;
}

// The slug is fixed after creation: /m/{slug} links are already shared in groups.
export class UpdateMerchantDto extends PartialType(OmitType(CreateMerchantDto, ['slug'] as const)) {}

export class MerchantDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null;
  @ApiProperty() contactEmail!: string;
  @ApiProperty() contactPhone!: string;
  @ApiProperty({ type: String, nullable: true }) gstNumber!: string | null;
  @ApiProperty({ enum: MerchantStatus, enumName: 'MerchantStatus' }) status!: MerchantStatus;
  @ApiProperty({ description: 'A Stripe connected account exists (onboarding may still be incomplete)' })
  stripeConnected!: boolean;
  @ApiProperty() chargesEnabled!: boolean;
  @ApiProperty() payoutsEnabled!: boolean;
  @ApiProperty() detailsSubmitted!: boolean;
  @ApiProperty() createdAt!: Date;
}
