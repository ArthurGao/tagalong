import { NotificationsModule } from '../notifications/notifications.module.js';
import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ListingCloseJob } from './listing-close.job.js';
import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';

@Module({
  imports: [UploadsModule, NotificationsModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingCloseJob],
})
export class ListingsModule {}
