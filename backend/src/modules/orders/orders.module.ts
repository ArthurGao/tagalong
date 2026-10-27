import { Module } from '@nestjs/common';
import { CloudflareTurnstileVerifier, TurnstileVerifier } from '../../common/security/turnstile.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StripeClientModule } from '../stripe/stripe-client.module.js';
import { CheckoutWebhooksService } from './checkout-webhooks.service.js';
import { CancellationService } from './cancellation.service.js';
import { ExpiryJob } from './expiry.job.js';
import { RefundProcessor } from './refund-processor.js';
import { RefundJob } from './refund.job.js';
import { MerchantOrdersController } from './merchant-orders.controller.js';
import { MerchantOrdersService } from './merchant-orders.service.js';
import { OrdersService } from './orders.service.js';
import { PublicOrdersController } from './public-orders.controller.js';

@Module({
  imports: [NotificationsModule, StripeClientModule],
  controllers: [PublicOrdersController, MerchantOrdersController],
  providers: [OrdersService, MerchantOrdersService, CancellationService, RefundProcessor, RefundJob, CheckoutWebhooksService, ExpiryJob, { provide: TurnstileVerifier, useClass: CloudflareTurnstileVerifier }],
  exports: [CheckoutWebhooksService],
})
export class OrdersModule {}
