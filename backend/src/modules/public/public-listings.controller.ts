import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ParticipantPageDto, ParticipantQueryDto, PublicListingDto } from './public-listing.dto.js';
import { PublicListingsService } from './public-listings.service.js';

// No auth: buyers are guests (DESIGN §2). Responses are allow-listed DTOs only.
@ApiTags('public')
@Controller('public/listings')
export class PublicListingsController {
  constructor(private readonly listings: PublicListingsService) {}

  @Get(':shortCode')
  @ApiOkResponse({ type: PublicListingDto })
  get(@Param('shortCode') shortCode: string): Promise<PublicListingDto> {
    return this.listings.get(shortCode);
  }

  @Get(':shortCode/participants')
  @ApiOkResponse({ type: ParticipantPageDto })
  participants(@Param('shortCode') shortCode: string, @Query() q: ParticipantQueryDto): Promise<ParticipantPageDto> {
    return this.listings.participants(shortCode, q.cursor, q.limit);
  }
}
