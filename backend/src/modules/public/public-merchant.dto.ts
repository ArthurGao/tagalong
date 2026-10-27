import { ApiProperty } from '@nestjs/swagger';
import { ListingType, Pricing } from '../../generated/prisma/enums.js';
import { AVAILABILITY, type Availability } from '../listings/availability.js';

export class MerchantPageListingDto {
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) coverImageUrl!: string | null;
  @ApiProperty({ enum: ListingType, enumName: 'ListingType' }) type!: ListingType;
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) pricing!: Pricing;
  @ApiProperty({ type: Number, nullable: true, description: 'Cheapest active option (null when none)' }) minPriceCents!: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxPriceCents!: number | null;
  @ApiProperty({ enum: AVAILABILITY, enumName: 'Availability' }) availability!: Availability;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closesAt!: Date | null;
}

/** The merchant's public page (DESIGN §11 `/m/[slug]`): its own words and listings, never contact details or ids. */
export class MerchantPageDto {
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) logoUrl!: string | null;
  @ApiProperty({ description: 'Suspended by the platform: no listings are shown' }) suspended!: boolean;
  @ApiProperty({ type: [MerchantPageListingDto] }) listings!: MerchantPageListingDto[];
}
