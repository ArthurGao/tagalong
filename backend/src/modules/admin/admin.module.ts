import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminController } from './admin.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminCancellationsService } from './admin-cancellations.service.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminMerchantsService } from './admin-merchants.service.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

@Module({
  imports: [NotificationsModule, ListingsModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminMerchantsService, AdminListingsService, AdminOverviewService, AdminOrdersService, AdminCancellationsService, AdminAuditService],
})
export class AdminModule {}
