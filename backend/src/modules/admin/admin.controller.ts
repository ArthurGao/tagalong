import { Body, Controller, createParamDecorator, type ExecutionContext, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth } from '../auth/auth.decorator.js';
import {
  AdminDisputeDto,
  AdminDisputesQueryDto,
  AdminListingDto,
  AdminListingPageDto,
  AdminListingsQueryDto,
  AdminMerchantDto,
  AdminMerchantPageDto,
  AdminMerchantsQueryDto,
  AdminReasonDto,
  AdminStatsDto,
  MerchantNoteDto,
  MerchantNoteInputDto,
  TakedownDto,
} from './admin.dto.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminMerchantsService } from './admin-merchants.service.js';
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
}
