import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Fulfilment, ListingStatus, ListingType, Pricing } from '../../generated/prisma/enums.js';
import { FORM_FIELD_TYPES, type FormField, type FormFieldType, MAX_FORM_FIELDS } from './form-fields.js';

export const MAX_IMAGES = 9;

/** Optional ISO date-time that may also be null (null clears it). */
const OptionalNullableDate = () =>
  applyDecorators(
    ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }),
    IsOptional(),
    ValidateIf((_, v) => v !== null),
    IsDateString(),
  );

export class FormFieldDto implements FormField {
  @ApiProperty({ example: 'child_age' })
  @Matches(/^[a-z][a-z0-9_]{0,29}$/, { message: 'key must be lowercase letters, digits or underscores' })
  key!: string;

  @ApiProperty() @IsString() @Length(1, 80) label!: string;
  @ApiProperty({ enum: FORM_FIELD_TYPES }) @IsIn(FORM_FIELD_TYPES) type!: FormFieldType;
  @ApiProperty() @IsBoolean() required!: boolean;
  @ApiProperty({ enum: ['order', 'attendee'] }) @IsIn(['order', 'attendee']) scope!: 'order' | 'attendee';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  options?: string[];
}

export class CreateListingDto {
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) @IsIn(Object.values(Pricing)) pricing!: Pricing;
  @ApiProperty({ enum: ListingType, enumName: 'ListingType' }) @IsIn(Object.values(ListingType)) type!: ListingType;
  @ApiProperty({ enum: Fulfilment, enumName: 'Fulfilment' }) @IsIn(Object.values(Fulfilment)) fulfilment!: Fulfilment;
  @ApiProperty() @IsString() @Length(1, 120) title!: string;
}

// pricing / type / fulfilment / title as on create (locked ones are checked by publish-rules), plus the rest.
export class UpdateListingDto extends PartialType(CreateListingDto) {
  @ApiPropertyOptional({ description: 'Markdown' }) @IsOptional() @IsString() @MaxLength(10_000) description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  images?: string[];

  @OptionalNullableDate()
  opensAt?: string | null;

  @OptionalNullableDate()
  closesAt?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) maxQtyPerOrder?: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  totalCapacity?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() indexable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showParticipants?: boolean;

  @ApiPropertyOptional({ type: [FormFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FORM_FIELDS)
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  formFields?: FormFieldDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() onePerEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSelfCancel?: boolean;

  @OptionalNullableDate()
  selfCancelUntil?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(168)
  remindBeforeHours?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5_000) policyText?: string;
}

export class OptionInputDto {
  @ApiPropertyOptional({ description: 'Existing option id; omit to create' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiProperty({ description: 'Integer NZD cents, GST inclusive' }) @IsInt() @Min(0) priceCents!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  capacity!: number | null;

  @OptionalNullableDate()
  startsAt?: string | null;

  @OptionalNullableDate()
  endsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) location?: string | null;
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class ReplaceOptionsDto {
  @ApiProperty({ type: [OptionInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OptionInputDto)
  options!: OptionInputDto[];
}

export class PickupPointInputDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiProperty() @IsString() @Length(1, 80) label!: string;
  @ApiProperty() @IsString() @Length(1, 300) address!: string;

  @OptionalNullableDate()
  windowStart?: string | null;

  @OptionalNullableDate()
  windowEnd?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) notes?: string | null;
}

export class ReplacePickupPointsDto {
  @ApiProperty({ type: [PickupPointInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PickupPointInputDto)
  pickupPoints!: PickupPointInputDto[];
}

export class ReopenListingDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @IsDateString() closesAt?: string;
}

export class ListingOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceCents!: number;
  @ApiProperty({ type: Number, nullable: true }) capacity!: number | null;
  @ApiProperty() soldCount!: number;
  @ApiProperty() reservedCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() active!: boolean;
}

export class PickupPointDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) windowStart!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) windowEnd!: Date | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
}

export class ListingSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() shortCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' }) status!: ListingStatus;
  @ApiProperty({ enum: Pricing, enumName: 'Pricing' }) pricing!: Pricing;
  @ApiProperty({ enum: ListingType, enumName: 'ListingType' }) type!: ListingType;
  @ApiProperty() soldCount!: number;
  @ApiProperty({ type: Number, nullable: true }) totalCapacity!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closesAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class ListingDto extends ListingSummaryDto {
  @ApiProperty({ enum: Fulfilment, enumName: 'Fulfilment' }) fulfilment!: Fulfilment;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) opensAt!: Date | null;
  @ApiProperty() maxQtyPerOrder!: number;
  @ApiProperty() reservedCount!: number;
  @ApiProperty() indexable!: boolean;
  @ApiProperty() showParticipants!: boolean;
  @ApiProperty({ type: [FormFieldDto] }) formFields!: FormFieldDto[];
  @ApiProperty({ type: [String], description: 'Keys of form fields whose label asks for sensitive data (DESIGN §10)' })
  formFieldWarnings!: string[];
  @ApiProperty() onePerEmail!: boolean;
  @ApiProperty() allowSelfCancel!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) selfCancelUntil!: Date | null;
  @ApiProperty({ type: Number, nullable: true }) remindBeforeHours!: number | null;
  @ApiProperty() policyText!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: Date | null;
  @ApiProperty({ type: [ListingOptionDto] }) options!: ListingOptionDto[];
  @ApiProperty({ type: [PickupPointDto] }) pickupPoints!: PickupPointDto[];
}
