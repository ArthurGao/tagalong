import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditActorRole, CancellationStatus, ListingStatus, MerchantStatus, OrderStatus, Pricing, RefundStatus } from '../../generated/prisma/enums.js';
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


// M8b: orders (masked PII, reveal, refund on the merchant's behalf), failed bulk refunds, anonymisation, audit log.

export class AdminOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Order code (TA-…), buyer email (exact, any case) or phone (6+ digits); none lists the newest' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' }) @IsOptional() @IsUUID() cursor?: string;
}

export class AdminRefundDto extends AdminReasonDto {
  @ApiProperty({ description: 'Integer NZD cents, at most what is still refundable; the reason is also told to the buyer' })
  @IsInt()
  @Min(1)
  amountCents!: number;
}

export class AnonymizeBuyerDto extends AdminReasonDto {
  @ApiProperty({ description: 'Every order with this buyer email (any case)' }) @IsEmail() @MaxLength(254) email!: string;
}

export class AdminCancellationsQueryDto {
  @ApiPropertyOptional({ enum: CancellationStatus, enumName: 'CancellationStatus' })
  @IsOptional()
  @IsIn(Object.values(CancellationStatus))
  status?: CancellationStatus;
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' }) @IsOptional() @IsUUID() cursor?: string;
}

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ description: "The actor's email (exact, any case)" }) @IsOptional() @IsString() @MaxLength(254) actor?: string;
  @ApiPropertyOptional({ description: 'e.g. MERCHANT_SUSPEND, PII_REVEAL, ADMIN_SIGN_IN' }) @IsOptional() @Matches(/^[A-Z_]{1,64}$/) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) targetId?: string;
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' }) @IsOptional() @IsUUID() cursor?: string;
}

export class AdminOrderListingDto {
  @ApiProperty() id!: string;
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
}

export class AdminOrderRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() publicCode!: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' }) status!: OrderStatus;
  @ApiProperty() isFree!: boolean;
  @ApiProperty({ description: 'Masked: "Arthur G."' }) buyerName!: string;
  @ApiProperty({ description: 'Masked: "a***@example.com"' }) buyerEmail!: string;
  @ApiProperty({ description: 'Masked: "*** 0101"' }) buyerPhone!: string;
  @ApiProperty({ description: 'PII replaced by a privacy request' }) anonymized!: boolean;
  @ApiProperty() totalCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiProperty({ description: 'Refunds decided but not yet confirmed by Stripe' }) pendingRefundCents!: number;
  @ApiProperty({ description: 'What an admin refund may still take; 0 when the order cannot be refunded' }) refundableCents!: number;
  @ApiProperty() lastRefundFailed!: boolean;
  @ApiProperty() openDispute!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt!: Date | null;
  @ApiProperty({ type: AdminOrderListingDto }) listing!: AdminOrderListingDto;
  @ApiProperty({ type: AdminListingMerchantDto }) merchant!: AdminListingMerchantDto;
}

export class AdminOrderPageDto {
  @ApiProperty({ type: [AdminOrderRowDto] }) items!: AdminOrderRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class AdminOrderItemDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceCents!: number;
}

export class AdminRefundRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: RefundStatus, enumName: 'RefundStatus' }) status!: RefundStatus;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AdminOrderDto extends AdminOrderRowDto {
  @ApiProperty({ type: [AdminOrderItemDto] }) items!: AdminOrderItemDto[];
  @ApiProperty({ type: [AdminRefundRowDto], description: 'Newest first' }) refunds!: AdminRefundRowDto[];
  @ApiProperty({ type: String, nullable: true }) pickupPointLabel!: string | null;
}

export class AdminAttendeeDto {
  @ApiProperty() optionName!: string;
  @ApiProperty({ type: String, nullable: true }) attendeeName!: string | null;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) attendeeAnswers!: Record<string, unknown>[];
}

export class AdminOrderPiiDto {
  @ApiProperty() buyerName!: string;
  @ApiProperty() buyerEmail!: string;
  @ApiProperty() buyerPhone!: string;
  @ApiProperty({ type: String, nullable: true }) buyerNote!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) formAnswers!: Record<string, unknown>;
  @ApiProperty({ type: [AdminAttendeeDto] }) items!: AdminAttendeeDto[];
}

export class AnonymizeResultDto {
  @ApiProperty() orderCount!: number;
  @ApiProperty({ type: [String] }) publicCodes!: string[];
}

export class AdminFailedRefundDto {
  @ApiProperty({ description: 'RefundTask id, for POST /admin/refund-tasks/:id/retry' }) id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderPublicCode!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() attempts!: number;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ description: 'Stripe refused it (a retry starts a new refund), rather than not answering' }) refused!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AdminCancellationRowDto extends AdminCancellationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: AdminOrderListingDto }) listing!: AdminOrderListingDto;
  @ApiProperty({ type: AdminListingMerchantDto }) merchant!: AdminListingMerchantDto;
  @ApiProperty({ type: [AdminFailedRefundDto] }) failedRefunds!: AdminFailedRefundDto[];
}

export class AdminCancellationPageDto {
  @ApiProperty({ type: [AdminCancellationRowDto] }) items!: AdminCancellationRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class AuditEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ enum: AuditActorRole, enumName: 'AuditActorRole' }) actorRole!: AuditActorRole;
  @ApiProperty({ type: String, nullable: true, description: 'null for SYSTEM (CLI, jobs)' }) actorEmail!: string | null;
  @ApiProperty() targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) ip!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] }) items!: AuditEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
