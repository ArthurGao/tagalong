import { Body, Controller, createParamDecorator, type ExecutionContext, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth } from '../auth/auth.decorator.js';
import {
  AdminAuditQueryDto,
  AdminCancellationPageDto,
  AdminCancellationRowDto,
  AdminCancellationsQueryDto,
  AdminDisputeDto,
  AdminDisputesQueryDto,
  AdminListingDto,
  AdminListingPageDto,
  AdminListingsQueryDto,
  AdminMerchantDto,
  AdminMerchantPageDto,
  AdminMerchantsQueryDto,
  AdminOrderDto,
  AdminOrderPageDto,
  AdminOrderPiiDto,
  AdminOrdersQueryDto,
  AdminReasonDto,
  AdminRefundDto,
  AdminStatsDto,
  AnonymizeBuyerDto,
  AnonymizeResultDto,
  AuditPageDto,
  MerchantNoteDto,
  MerchantNoteInputDto,
  TakedownDto,
} from './admin.dto.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminCancellationsService } from './admin-cancellations.service.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminMerchantsService } from './admin-merchants.service.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminOverviewService } from './admin-overview.service.js';
import type { AdminActor } from './audit.js';

/** The admin behind a write and the request's client IP (trusted proxies only, app.setup.ts), for the audit log. */
const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): AdminActor => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return { userId: req.user.id, ip: req.ip ?? null };
});

// DESIGN §9 Admin. RolesGuard reads the role from the database on every request, so a revoked admin is out at once.
@ApiTags('admin')
@Auth('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly merchants: AdminMerchantsService,
    private readonly listings: AdminListingsService,
    private readonly overview: AdminOverviewService,
    private readonly orders: AdminOrdersService,
    private readonly cancellations: AdminCancellationsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('stats')
  @ApiOkResponse({ type: AdminStatsDto })
  stats(): Promise<AdminStatsDto> {
    return this.overview.stats();
  }

  @Get('disputes')
  @ApiOkResponse({ type: [AdminDisputeDto] })
  disputes(@Query() q: AdminDisputesQueryDto): Promise<AdminDisputeDto[]> {
    return this.overview.disputes(q);
  }

  @Get('merchants')
  @ApiOkResponse({ type: AdminMerchantPageDto })
  listMerchants(@Query() q: AdminMerchantsQueryDto): Promise<AdminMerchantPageDto> {
    return this.merchants.list(q);
  }

  @Get('merchants/:id')
  @ApiOkResponse({ type: AdminMerchantDto })
  merchant(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMerchantDto> {
    return this.merchants.get(id);
  }

  @Post('merchants/:id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminMerchantDto })
  suspend(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminMerchantDto> {
    return this.merchants.suspend(actor, id, dto.reason);
  }

  @Post('merchants/:id/reinstate')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminMerchantDto })
  reinstate(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminMerchantDto> {
    return this.merchants.reinstate(actor, id, dto.reason);
  }

  @Post('merchants/:id/notes')
  @ApiOkResponse({ type: MerchantNoteDto })
  addNote(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MerchantNoteInputDto): Promise<MerchantNoteDto> {
    return this.merchants.addNote(actor, id, dto.note);
  }

  @Get('listings')
  @ApiOkResponse({ type: AdminListingPageDto })
  listListings(@Query() q: AdminListingsQueryDto): Promise<AdminListingPageDto> {
    return this.listings.list(q);
  }

  @Get('listings/:id')
  @ApiOkResponse({ type: AdminListingDto })
  listing(@Param('id', ParseUUIDPipe) id: string): Promise<AdminListingDto> {
    return this.listings.get(id);
  }

  @Post('listings/:id/close')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminListingDto })
  close(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminListingDto> {
    return this.listings.close(actor, id, dto.reason);
  }

  @Post('listings/:id/takedown')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminListingDto })
  takedown(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TakedownDto): Promise<AdminListingDto> {
    return this.listings.takedown(actor, id, dto);
  }

  @Post('listings/:id/restore')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminListingDto })
  restore(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminListingDto> {
    return this.listings.restore(actor, id, dto.reason);
  }

  @Get('orders')
  @ApiOkResponse({ type: AdminOrderPageDto })
  listOrders(@Query() q: AdminOrdersQueryDto): Promise<AdminOrderPageDto> {
    return this.orders.list(q);
  }

  @Get('orders/:id')
  @ApiOkResponse({ type: AdminOrderDto })
  order(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDto> {
    return this.orders.get(id);
  }

  @Post('orders/:id/reveal-pii')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderPiiDto })
  revealPii(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminOrderPiiDto> {
    return this.orders.revealPii(actor, id, dto.reason);
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDto })
  refund(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminRefundDto): Promise<AdminOrderDto> {
    return this.orders.refund(actor, id, dto.amountCents, dto.reason);
  }

  @Post('buyers/anonymize')
  @HttpCode(200)
  @ApiOkResponse({ type: AnonymizeResultDto })
  anonymize(@Actor() actor: AdminActor, @Body() dto: AnonymizeBuyerDto): Promise<AnonymizeResultDto> {
    return this.orders.anonymize(actor, dto.email, dto.reason);
  }

  @Get('cancellations')
  @ApiOkResponse({ type: AdminCancellationPageDto })
  listCancellations(@Query() q: AdminCancellationsQueryDto): Promise<AdminCancellationPageDto> {
    return this.cancellations.list(q);
  }

  @Post('refund-tasks/:id/retry')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminCancellationRowDto })
  retryRefund(@Actor() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto): Promise<AdminCancellationRowDto> {
    return this.cancellations.retry(actor, id, dto.reason);
  }

  @Get('audit-log')
  @ApiOkResponse({ type: AuditPageDto })
  auditLog(@Query() q: AdminAuditQueryDto): Promise<AuditPageDto> {
    return this.audit.list(q);
  }
}
