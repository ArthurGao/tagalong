import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { MerchantStripeController } from './merchant-stripe.controller.js';
import { MerchantStripeService } from './merchant-stripe.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { StripeClientModule } from './stripe-client.module.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

@Module({
  imports: [MerchantsModule, StripeClientModule, OrdersModule],
  controllers: [MerchantStripeController, StripeWebhookController],
  providers: [MerchantStripeService],
})
export class StripeModule {}
