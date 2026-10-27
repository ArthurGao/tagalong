import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { MerchantStripeController } from './merchant-stripe.controller.js';
import { MerchantStripeService } from './merchant-stripe.service.js';
import { StripeClient, StripeSdkClient } from './stripe-client.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

@Module({
  imports: [MerchantsModule],
  controllers: [MerchantStripeController, StripeWebhookController],
  providers: [{ provide: StripeClient, useClass: StripeSdkClient }, MerchantStripeService],
})
export class StripeModule {}
