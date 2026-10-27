import { Body, Controller, Get, Header, Headers, HttpCode, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiHeader, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto, CreateOrderResultDto, PublicOrderDto, RecoverOrdersDto, RecoverOrdersResultDto } from './order.dto.js';
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

  @Post('orders/recover')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard) // per IP, as order creation; per email: 3 an hour in the service
  @ApiOkResponse({ type: RecoverOrdersResultDto })
  recover(@Body() dto: RecoverOrdersDto, @Ip() ip: string): Promise<RecoverOrdersResultDto> {
    return this.orders.recover(dto, ip);
  }

  @Get('orders/:publicCode')
  @ApiHeader(ORDER_TOKEN)
  @ApiOkResponse({ type: PublicOrderDto })
  get(@Param('publicCode') code: string, @Headers('x-order-token') token = ''): Promise<PublicOrderDto> {
    return this.orders.get(code, token);
  }

  @Get('orders/:publicCode/calendar.ics')
  @ApiHeader(ORDER_TOKEN)
  @ApiProduces('text/calendar')
  @ApiOkResponse({ description: 'RFC 5545 calendar file', schema: { type: 'string' } })
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment') // the page names the file (ics.icsFilename) when it saves it
  calendar(@Param('publicCode') code: string, @Headers('x-order-token') token = ''): Promise<string> {
    return this.orders.calendar(code, token);
  }

  @Post('orders/:publicCode/cancel')
  @HttpCode(200)
  @ApiHeader(ORDER_TOKEN)
  @ApiOkResponse({ type: PublicOrderDto })
  cancel(@Param('publicCode') code: string, @Headers('x-order-token') token = ''): Promise<PublicOrderDto> {
    return this.orders.cancel(code, token);
  }
}
