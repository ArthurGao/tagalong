import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StripeClientModule } from '../stripe/stripe-client.module.js';
import { CheckoutWebhooksService } from './checkout-webhooks.service.js';
import { ExpiryJob } from './expiry.job.js';
import { OrdersService } from './orders.service.js';
import { PublicOrdersController } from './public-orders.controller.js';

@Module({
  imports: [NotificationsModule, StripeClientModule],
  controllers: [PublicOrdersController],
  providers: [OrdersService, CheckoutWebhooksService, ExpiryJob],
  exports: [CheckoutWebhooksService],
})
export class OrdersModule {}
