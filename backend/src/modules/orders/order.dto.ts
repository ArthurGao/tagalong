import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LOCALES, type Locale } from '../../common/locale.js';
import { PHONE } from '../../common/validation.js';
import { OrderStatus } from '../../generated/prisma/enums.js';


export class OrderItemInputDto {
  @ApiProperty() @IsUUID() optionId!: string;
  @ApiProperty({ minimum: 1, maximum: 50 }) @IsInt() @Min(1) @Max(50) quantity!: number;
}

export class BuyerInputDto {
  @ApiProperty() @IsString() @Length(1, 60) name!: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @Matches(PHONE, { message: 'phone must be 6-20 digits, spaces, (), - or a leading +' }) phone!: string;
}

// Prices are never accepted from the client (root CLAUDE.md rule 3): only option ids and quantities.
export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemInputDto] })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @ApiProperty({ type: BuyerInputDto }) @ValidateNested() @Type(() => BuyerInputDto) buyer!: BuyerInputDto;
  @ApiPropertyOptional() @IsOptional() @IsUUID() pickupPointId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ description: 'Show as "anonymous" on the public sign-up sheet' }) @IsBoolean() anonymous!: boolean;
  @ApiPropertyOptional({ enum: LOCALES, description: 'Buyer UI language, used for emails' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class CreateOrderResultDto {
  @ApiProperty({ enum: ['checkout', 'confirmed'] }) kind!: 'checkout' | 'confirmed';
  @ApiPropertyOptional({ description: 'Paid listings: Stripe Checkout URL to redirect to' }) checkoutUrl?: string;
}

export class PublicOrderItemDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceCents!: number;
}

export class PublicOrderPickupDto {
  @ApiProperty() label!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) windowStart!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) windowEnd!: Date | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
}

export class PublicOrderListingDto {
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
}

// The order page for the token holder: their own order only. No other buyer's data, no Stripe ids.
export class PublicOrderDto {
  @ApiProperty() publicCode!: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' }) status!: OrderStatus;
  @ApiProperty() isFree!: boolean;
  @ApiProperty({ description: 'The buyer may cancel it now' }) canCancel!: boolean;
  @ApiProperty({ type: Number, nullable: true }) sequenceNo!: number | null;
  @ApiProperty() buyerName!: string;
  @ApiProperty({ type: [PublicOrderItemDto] }) items!: PublicOrderItemDto[];
  @ApiProperty() subtotalCents!: number;
  @ApiProperty() totalCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiProperty({ type: PublicOrderPickupDto, nullable: true }) pickupPoint!: PublicOrderPickupDto | null;
  @ApiProperty({ type: PublicOrderListingDto }) listing!: PublicOrderListingDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reservationExpiresAt!: Date | null;
}
