import { Module } from '@nestjs/common';
import { StripeClient, StripeSdkClient } from './stripe-client.js';

// Its own module so that both the Stripe module (webhooks, Connect) and orders can use the client.
@Module({
  providers: [{ provide: StripeClient, useClass: StripeSdkClient }],
  exports: [StripeClient],
})
export class StripeClientModule {}
