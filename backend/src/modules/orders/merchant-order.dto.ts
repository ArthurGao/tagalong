import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { ListingStatus, OrderStatus, Pricing } from '../../generated/prisma/enums.js';

import { ANSWERS } from './order.dto.js';

export class MerchantOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus, enumName: 'OrderStatus' }) @IsOptional() @IsIn(Object.values(OrderStatus)) status?: OrderStatus;
  @ApiPropertyOptional({ description: 'Name, email, phone or order code' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class RefundOrderDto {
  @ApiProperty({ description: 'Integer NZD cents, at most what is still refundable' }) @IsInt() @Min(1) amountCents!: number;
  @ApiProperty({ description: 'Told to the buyer' }) @IsString() @Length(1, 500) reason!: string;
}

export class MerchantCancelOrderDto {
  @ApiProperty({ description: 'Told to the buyer' }) @IsString() @Length(1, 500) reason!: string;
}

export class MerchantOrderItemDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceCents!: number;
  @ApiProperty({ type: 'array', items: ANSWERS }) attendeeAnswers!: Record<string, unknown>[];
}

// The merchant's own buyers: PII is expected here, scoped to the merchant's listings only.
export class MerchantOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() publicCode!: string;
  @ApiProperty({ type: Number, nullable: true }) sequenceNo!: number | null;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' }) status!: OrderStatus;
  @ApiProperty() isFree!: boolean;
  @ApiProperty() buyerName!: string;
  @ApiProperty() buyerEmail!: string;
  @ApiProperty() buyerPhone!: string;
  @ApiProperty({ type: String, nullable: true }) buyerNote!: string | null;
  @ApiProperty() displayAnonymous!: boolean;
  @ApiProperty(ANSWERS) formAnswers!: Record<string, unknown>;
  @ApiProperty({ type: [MerchantOrderItemDto] }) items!: MerchantOrderItemDto[];
  @ApiProperty() totalCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiProperty({ type: String, nullable: true }) pickupPointLabel!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) fulfilledAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ description: 'Check in (free) or mark collected (paid) is possible now' }) canFulfil!: boolean;
  @ApiProperty({ description: 'Cancel with a reason (free registrations only)' }) canCancel!: boolean;
  @ApiProperty({ description: 'Mark no-show (free, once the event has started)' }) canNoShow!: boolean;
  @ApiProperty({ description: 'Paid: what can still be refunded (total less refunded and refunds in flight)' }) refundableCents!: number;
}

export class MerchantOrderListingDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) pricing!: Pricing;
  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' }) status!: ListingStatus;
}

export class MerchantOrderListDto {
  @ApiProperty({ type: MerchantOrderListingDto }) listing!: MerchantOrderListingDto;
  @ApiProperty({ type: [MerchantOrderDto] }) orders!: MerchantOrderDto[];
}
