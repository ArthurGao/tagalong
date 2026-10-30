import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminController } from './admin.controller.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminMerchantsService } from './admin-merchants.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

@Module({
  imports: [NotificationsModule, ListingsModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminMerchantsService, AdminListingsService, AdminOverviewService],
})
export class AdminModule {}
