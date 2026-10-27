import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ErrorBodyDto } from '../../common/errors/error-body.dto.js';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { CreateMerchantDto, MerchantDto, UpdateMerchantDto } from './merchant.dto.js';
import { MerchantsService, toMerchantDto } from './merchants.service.js';

@ApiTags('merchants')
@Auth('MERCHANT')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @ApiCreatedResponse({ type: MerchantDto })
  @ApiConflictResponse({ type: ErrorBodyDto, description: 'MERCHANT_PROFILE_EXISTS or SLUG_TAKEN' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateMerchantDto): Promise<MerchantDto> {
    return toMerchantDto(await this.merchants.create(user.id, dto));
  }

  @Get('me')
  @ApiOkResponse({ type: MerchantDto })
  async getOwn(@CurrentUser() user: AuthUser): Promise<MerchantDto> {
    return toMerchantDto(await this.merchants.getOwn(user.id));
  }

  @Patch('me')
  @ApiOkResponse({ type: MerchantDto })
  async updateOwn(@CurrentUser() user: AuthUser, @Body() dto: UpdateMerchantDto): Promise<MerchantDto> {
    return toMerchantDto(await this.merchants.updateOwn(user.id, dto));
  }
}
