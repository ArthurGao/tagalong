import { Controller, Get, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { MerchantDto } from '../merchants/merchant.dto.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { MerchantStripeService } from './merchant-stripe.service.js';

export class StripeLinkDto {
  @ApiProperty() url!: string;
}

@ApiTags('stripe')
@Auth('MERCHANT')
@Controller('merchants/me/stripe')
export class MerchantStripeController {
  constructor(
    private readonly service: MerchantStripeService,
    private readonly merchants: MerchantsService,
  ) {}

  @Post('onboard')
  @ApiCreatedResponse({ type: StripeLinkDto })
  async onboard(@CurrentUser() user: AuthUser): Promise<StripeLinkDto> {
    return { url: await this.service.onboard(user) };
  }

  /** The merchant profile after re-reading the live Stripe account. */
  @Get('status')
  @ApiOkResponse({ type: MerchantDto })
  async status(@CurrentUser() user: AuthUser): Promise<MerchantDto> {
    return this.merchants.toDto(await this.service.syncOwn(user));
  }
}
