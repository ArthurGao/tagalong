import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Fulfilment, ListingStatus, ListingType, Pricing } from '../../generated/prisma/enums.js';
import { FormFieldDto, PickupPointDto } from '../listings/listing.dto.js';
import { AVAILABILITY, type Availability } from '../listings/availability.js';

// Public responses are explicit allow-lists (DESIGN §10): no ids, no merchant contact details, no buyer PII.

export class PublicOptionDto {
  @ApiProperty({ description: 'What an order refers to' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceCents!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Places left; null = unlimited' }) remaining!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
}

export class PublicPickupPointDto extends PickupPointDto {}

export class PublicMerchantDto {
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null;
  @ApiProperty({ description: 'Completed Stripe verification (D12)' }) verified!: boolean;
}

export class PublicListingDto {
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Markdown' }) description!: string;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ enum: ListingType, enumName: 'ListingType' }) type!: ListingType;
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) pricing!: Pricing;
  @ApiProperty({ enum: Fulfilment, enumName: 'Fulfilment' }) fulfilment!: Fulfilment;
  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' }) status!: ListingStatus;
  @ApiProperty({ enum: AVAILABILITY, enumName: 'Availability' }) availability!: Availability;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) opensAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closesAt!: Date | null;
  @ApiProperty() maxQtyPerOrder!: number;
  @ApiProperty() policyText!: string;
  @ApiProperty() indexable!: boolean;
  @ApiProperty() showParticipants!: boolean;
  @ApiProperty() joinedCount!: number;
  @ApiProperty({ type: Number, nullable: true }) totalCapacity!: number | null;
  @ApiProperty({ type: Number, nullable: true }) totalRemaining!: number | null;
  @ApiProperty({ type: [FormFieldDto] }) formFields!: FormFieldDto[];
  @ApiProperty({ type: [PublicOptionDto] }) options!: PublicOptionDto[];
  @ApiProperty({ type: [PublicPickupPointDto] }) pickupPoints!: PublicPickupPointDto[];
  @ApiProperty({ type: PublicMerchantDto }) merchant!: PublicMerchantDto;
}

export class ParticipantDto {
  @ApiProperty() seq!: number;
  @ApiProperty({ type: String, nullable: true, description: 'Masked name; null when the buyer chose anonymous' })
  displayName!: string | null;
  @ApiProperty() anonymous!: boolean;
  @ApiProperty({ example: '2kg ×1, 5kg ×2' }) summary!: string;
  @ApiProperty() joinedAt!: Date;
}

export class ParticipantPageDto {
  @ApiProperty({ type: [ParticipantDto] }) items!: ParticipantDto[];
  @ApiProperty({ type: Number, nullable: true, description: 'Pass as cursor for the next (older) page' })
  nextCursor!: number | null;
}

export class ParticipantQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, description: 'Last seq of the previous page' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) cursor?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
