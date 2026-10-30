import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { ListingStatus, MerchantStatus, OrderStatus, Pricing } from '../../generated/prisma/enums.js';
import { CancellationProgressDto } from '../orders/cancellation.dto.js';
import { RISK_FLAGS, type RiskFlag } from './risk.js';

// Every admin write carries a reason, kept in the audit log (DESIGN §9).
export class AdminReasonDto {
  @ApiProperty({ description: 'Why; kept in the audit log' }) @IsString() @Length(1, 500) reason!: string;
}

export class TakedownDto extends AdminReasonDto {
  @ApiProperty({ description: 'Refund every paid order in full (paid) or cancel every registration (free); otherwise orders stay and the takedown can be restored' })
  @IsBoolean()
  refundAll!: boolean;
}

export class MerchantNoteInputDto {
  @ApiProperty() @IsString() @Length(1, 2000) note!: string;
}

export class AdminMerchantsQueryDto {
  @ApiPropertyOptional({ enum: MerchantStatus, enumName: 'MerchantStatus' }) @IsOptional() @IsIn(Object.values(MerchantStatus)) status?: MerchantStatus;
  @ApiPropertyOptional({ enum: ['true'], description: 'Only merchants with a risk flag' }) @IsOptional() @IsIn(['true']) risk?: 'true';
  @ApiPropertyOptional({ description: 'Name, slug or contact email' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' }) @IsOptional() @IsUUID() cursor?: string;
}

export class AdminListingsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional({ enum: ListingStatus, enumName: 'ListingStatus' }) @IsOptional() @IsIn(Object.values(ListingStatus)) status?: ListingStatus;
  @ApiPropertyOptional({ enum: Pricing, enumName: 'Pricing' }) @IsOptional() @IsIn(Object.values(Pricing)) pricing?: Pricing;
  @ApiPropertyOptional({ description: 'Title or short code' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' }) @IsOptional() @IsUUID() cursor?: string;
}

export class AdminDisputesQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'closed'] }) @IsOptional() @IsIn(['open', 'closed']) status?: 'open' | 'closed';
  @ApiPropertyOptional({ description: 'At most this many, newest first (default and maximum 200)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AdminMerchantRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ enum: MerchantStatus, enumName: 'MerchantStatus' }) status!: MerchantStatus;
  @ApiProperty() chargesEnabled!: boolean;
  @ApiProperty({ enum: RISK_FLAGS, enumName: 'RiskFlag', isArray: true }) riskFlags!: RiskFlag[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminMerchantPageDto {
  @ApiProperty({ type: [AdminMerchantRowDto] }) items!: AdminMerchantRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class RiskFiguresDto {
  @ApiProperty({ description: 'Paid in the last 90 days, cents' }) paidCents90d!: number;
  @ApiProperty({ description: 'Of which refunded, cents' }) refundedCents90d!: number;
  @ApiProperty() openDisputes!: number;
  @ApiProperty({ description: 'Paid since Auckland midnight, cents' }) todayCents!: number;
  @ApiProperty({ description: 'Paid in the 30 Auckland days before today, cents' }) previous30dCents!: number;
}

export class MerchantNoteDto {
  @ApiProperty() id!: string;
  @ApiProperty() note!: string;
  @ApiProperty() authorEmail!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminListingBriefDto {
  @ApiProperty() id!: string;
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' }) status!: ListingStatus;
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) pricing!: Pricing;
  @ApiProperty() soldCount!: number;
  @ApiProperty() takenDown!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminMerchantDto extends AdminMerchantRowDto {
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() contactPhone!: string;
  @ApiProperty({ type: String, nullable: true }) gstNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) suspendedReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) suspendedAt!: Date | null;
  @ApiProperty({ description: 'The owner deleted their account: the shop cannot be reinstated' }) ownerDeleted!: boolean;
  @ApiProperty({ type: String, nullable: true }) stripeAccountId!: string | null;
  @ApiProperty() payoutsEnabled!: boolean;
  @ApiProperty() detailsSubmitted!: boolean;
  @ApiProperty({ type: RiskFiguresDto }) figures!: RiskFiguresDto;
  @ApiProperty() orderCount!: number;
  @ApiProperty() disputeCount!: number;
  @ApiProperty({ type: [AdminListingBriefDto], description: 'Newest 50' }) listings!: AdminListingBriefDto[];
  @ApiProperty({ type: [MerchantNoteDto], description: 'Newest first' }) notes!: MerchantNoteDto[];
}

export class AdminListingMerchantDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: MerchantStatus, enumName: 'MerchantStatus' }) status!: MerchantStatus;
}

export class AdminListingRowDto extends AdminListingBriefDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closesAt!: Date | null;
  @ApiProperty({ type: AdminListingMerchantDto }) merchant!: AdminListingMerchantDto;
}

export class AdminListingPageDto {
  @ApiProperty({ type: [AdminListingRowDto] }) items!: AdminListingRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class AdminOptionDto {
  @ApiProperty() name!: string;
  @ApiProperty() priceCents!: number;
  @ApiProperty({ type: Number, nullable: true }) capacity!: number | null;
  @ApiProperty() soldCount!: number;
  @ApiProperty() reservedCount!: number;
  @ApiProperty() active!: boolean;
}

export class OrderCountDto {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' }) status!: OrderStatus;
  @ApiProperty() count!: number;
}

export class AdminCancellationDto extends CancellationProgressDto {
  @ApiProperty() reason!: string;
  @ApiProperty() refundAll!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminListingDto extends AdminListingRowDto {
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) takenDownReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) takenDownAt!: Date | null;
  @ApiProperty({ type: [AdminOptionDto] }) options!: AdminOptionDto[];
  @ApiProperty({ type: [OrderCountDto] }) orderCounts!: OrderCountDto[];
  @ApiProperty({ type: AdminCancellationDto, nullable: true }) cancellation!: AdminCancellationDto | null;
  @ApiProperty({ description: 'PUBLISHED: can be closed early' }) canClose!: boolean;
  @ApiProperty({ description: 'PUBLISHED or CLOSED: can be taken down' }) canTakedown!: boolean;
  @ApiProperty({ description: 'Taken down without refunds or cancellations: can be restored (to CLOSED)' }) canRestore!: boolean;
}

export class AdminStatsDto {
  @ApiProperty({ description: 'Merchants created since Auckland midnight' }) newMerchantsToday!: number;
  @ApiProperty({ description: 'Paid in the last 7 days, cents' }) gmv7dCents!: number;
  @ApiProperty({ description: 'Paid in the last 30 days, cents' }) gmv30dCents!: number;
  @ApiProperty() openDisputes!: number;
}

export class AdminDisputeDto {
  @ApiProperty({ description: 'Stripe dispute id (dp_…)' }) id!: string;
  @ApiProperty({ description: "Stripe's status" }) status!: string;
  @ApiProperty() open!: boolean;
  @ApiProperty() amountCents!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: Date | null;
  @ApiProperty() orderPublicCode!: string;
  @ApiProperty() listingTitle!: string;
  @ApiProperty({ type: AdminListingMerchantDto }) merchant!: AdminListingMerchantDto;
}

