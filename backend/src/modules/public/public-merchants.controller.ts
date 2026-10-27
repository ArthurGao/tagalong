import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MerchantPageDto } from './public-merchant.dto.js';
import { PublicMerchantsService } from './public-merchants.service.js';

// No auth (DESIGN §2); an allow-listed DTO only: no contact details, GST number, Stripe account or ids.
@ApiTags('public')
@Controller('public/merchants')
export class PublicMerchantsController {
  constructor(private readonly merchants: PublicMerchantsService) {}

  @Get(':slug')
  @ApiOkResponse({ type: MerchantPageDto })
  get(@Param('slug') slug: string): Promise<MerchantPageDto> {
    return this.merchants.get(slug);
  }
}
