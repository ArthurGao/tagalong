import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { CancellationStatus } from '../../generated/prisma/enums.js';

export class CancelListingDto {
  @ApiProperty({ description: 'Told to every buyer' }) @IsString() @Length(1, 500) reason!: string;
  @ApiProperty({ description: 'The listing title, typed by the merchant to confirm (DESIGN §8.5)' }) @IsString() @Length(1, 200) confirmTitle!: string;
}

export class CancellationPreviewDto {
  @ApiProperty({ description: 'Paid orders that will be refunded' }) paidOrders!: number;
  @ApiProperty({ description: 'What they will get back, in cents (Stripe fees are not returned to the merchant)' }) refundTotalCents!: number;
  @ApiProperty({ description: 'Free registrations that will be cancelled' }) registrations!: number;
  @ApiProperty({ description: 'Unpaid checkouts that will be ended' }) unpaidOrders!: number;
}

export class CancellationProgressDto {
  @ApiProperty({ enum: CancellationStatus, enumName: 'CancellationStatus' }) status!: CancellationStatus;
  @ApiProperty() totalOrders!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() pending!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt!: Date | null;
}
