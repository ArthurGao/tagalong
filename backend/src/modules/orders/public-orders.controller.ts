import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto, CreateOrderResultDto, PublicOrderDto } from './order.dto.js';
import { OrdersService } from './orders.service.js';

// Buyers are guests (DESIGN §2): no auth. Writes still pass OriginGuard (same-site only).
// The order token travels in a header, not the query string, so proxies and request logs never see it.
const ORDER_TOKEN = { name: 'X-Order-Token', required: true, description: 'Access token from the order link' };
@ApiTags('public')
@Controller('public')
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('listings/:shortCode/orders')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard) // ORDER_RATE_LIMIT_PER_MINUTE per IP (DESIGN §10)
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID generated when the form opens (DESIGN §7.2)' })
  @ApiOkResponse({ type: CreateOrderResultDto })
  create(
    @Param('shortCode') shortCode: string,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
  ): Promise<CreateOrderResultDto> {
    return this.orders.create(shortCode, dto, key, ip);
  }

  @Get('orders/:publicCode')
  @ApiHeader(ORDER_TOKEN)
  @ApiOkResponse({ type: PublicOrderDto })
  get(@Param('publicCode') code: string, @Headers('x-order-token') token = ''): Promise<PublicOrderDto> {
    return this.orders.get(code, token);
  }

  @Post('orders/:publicCode/cancel')
  @HttpCode(200)
  @ApiHeader(ORDER_TOKEN)
  @ApiOkResponse({ type: PublicOrderDto })
  cancel(@Param('publicCode') code: string, @Headers('x-order-token') token = ''): Promise<PublicOrderDto> {
    return this.orders.cancel(code, token);
  }
}
