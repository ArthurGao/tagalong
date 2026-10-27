import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/auth.decorator.js';
import { CancelListingDto, CancellationPreviewDto, CancellationProgressDto } from './cancellation.dto.js';
import { CancellationService } from './cancellation.service.js';
import { MerchantCancelOrderDto, MerchantOrderDto, MerchantOrderListDto, MerchantOrdersQueryDto, RefundOrderDto } from './merchant-order.dto.js';
import { MerchantOrdersService } from './merchant-orders.service.js';

@ApiTags('orders')
@Auth('MERCHANT')
@Controller('merchants/me')
export class MerchantOrdersController {
  constructor(
    private readonly orders: MerchantOrdersService,
    private readonly cancellations: CancellationService,
  ) {}

  @Get('listings/:id/orders.csv')
  @ApiProduces('text/csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { filename, body } = await this.orders.csv(user, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  }

  @Get('listings/:id/cancellation/preview')
  @ApiOkResponse({ type: CancellationPreviewDto })
  cancelPreview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CancellationPreviewDto> {
    return this.cancellations.preview(user, id);
  }

  @Post('listings/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: CancellationProgressDto })
  cancelListing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelListingDto): Promise<CancellationProgressDto> {
    return this.cancellations.cancel(user, id, dto);
  }

  @Get('listings/:id/cancellation')
  @ApiOkResponse({ type: CancellationProgressDto })
  cancellation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CancellationProgressDto> {
    return this.cancellations.progress(user, id);
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantOrderDto })
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundOrderDto): Promise<MerchantOrderDto> {
    return this.orders.refund(user, id, dto.amountCents, dto.reason);
  }

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
