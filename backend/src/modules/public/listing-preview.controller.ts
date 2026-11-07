import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { PublicListingDto } from './public-listing.dto.js';
import { PublicListingsService } from './public-listings.service.js';

// Lives in the public module because it answers with the buyer page's DTO; the route is the merchant's own.
@ApiTags('listings')
@Auth('MERCHANT')
@Controller('merchants/me/listings')
export class ListingPreviewController {
  constructor(private readonly listings: PublicListingsService) {}

  @Get(':id/preview')
  @ApiOkResponse({ type: PublicListingDto })
  preview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PublicListingDto> {
    return this.listings.preview(requireMerchantId(user), id);
  }
}
