import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { MerchantCancelOrderDto, MerchantOrderDto, MerchantOrderListDto, MerchantOrdersQueryDto } from './merchant-order.dto.js';
import { MerchantOrdersService } from './merchant-orders.service.js';

@ApiTags('orders')
@Auth('MERCHANT')
@Controller('merchants/me')
export class MerchantOrdersController {
  constructor(private readonly orders: MerchantOrdersService) {}

  @Get('listings/:id/orders')
  @ApiOkResponse({ type: MerchantOrderListDto })
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MerchantOrdersQueryDto): Promise<MerchantOrderListDto> {
    return this.orders.list(user, id, q);
  }

  @Post('orders/:id/fulfil')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantOrderDto })
  fulfil(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MerchantOrderDto> {
    return this.orders.fulfil(user, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantOrderDto })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MerchantCancelOrderDto): Promise<MerchantOrderDto> {
    return this.orders.cancel(user, id, dto.reason);
  }

  @Post('orders/:id/no-show')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantOrderDto })
  noShow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MerchantOrderDto> {
    return this.orders.noShow(user, id);
  }
}
