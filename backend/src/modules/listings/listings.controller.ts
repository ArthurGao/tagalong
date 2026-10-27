import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import {
  CreateListingDto,
  ListingDto,
  ListingSummaryDto,
  ReopenListingDto,
  ReplaceOptionsDto,
  ReplacePickupPointsDto,
  UpdateListingDto,
} from './listing.dto.js';
import { ListingsService, toListingDto, toListingSummary } from './listings.service.js';

@ApiTags('listings')
@Auth('MERCHANT')
@Controller('merchants/me/listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOkResponse({ type: [ListingSummaryDto] })
  async list(@CurrentUser() user: AuthUser): Promise<ListingSummaryDto[]> {
    return (await this.listings.list(user)).map(toListingSummary);
  }

  @Post()
  @ApiCreatedResponse({ type: ListingDto })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto): Promise<ListingDto> {
    return toListingDto(await this.listings.create(user, dto));
  }

  @Get(':id')
  @ApiOkResponse({ type: ListingDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ListingDto> {
    return toListingDto(await this.listings.get(user, id));
  }

  @Patch(':id')
  @ApiOkResponse({ type: ListingDto })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<ListingDto> {
    return toListingDto(await this.listings.update(user, id, dto));
  }

  @Put(':id/options')
  @ApiOkResponse({ type: ListingDto })
  async replaceOptions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceOptionsDto,
  ): Promise<ListingDto> {
    return toListingDto(await this.listings.replaceOptions(user, id, dto));
  }

  @Put(':id/pickup-points')
  @ApiOkResponse({ type: ListingDto })
  async replacePickupPoints(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePickupPointsDto,
  ): Promise<ListingDto> {
    return toListingDto(await this.listings.replacePickupPoints(user, id, dto));
  }

  @Post(':id/publish')
  @ApiCreatedResponse({ type: ListingDto })
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ListingDto> {
    return toListingDto(await this.listings.publish(user, id));
  }

  @Post(':id/close')
  @ApiCreatedResponse({ type: ListingDto })
  async close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ListingDto> {
    return toListingDto(await this.listings.close(user, id));
  }

  @Post(':id/reopen')
  @ApiCreatedResponse({ type: ListingDto })
  async reopen(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenListingDto,
  ): Promise<ListingDto> {
    return toListingDto(await this.listings.reopen(user, id, dto.closesAt));
  }
}
