import { Controller, HttpCode, Inject, Logger, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CheckoutWebhooksService } from '../orders/checkout-webhooks.service.js';
import { MerchantStripeService } from './merchant-stripe.service.js';
import { StripeClient } from './stripe-client.js';

// DESIGN §8.3: two endpoints, two signing secrets. Each event is recorded in StripeEvent; it is skipped
// only once processedAt is set, so an event whose first processing threw (500) is processed on retry.
@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly stripe: StripeClient,
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantStripeService,
    private readonly checkout: CheckoutWebhooksService,
  ) {}

  @Post('connect')
  @HttpCode(200)
  connect(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    return this.receive(req, this.env.STRIPE_WEBHOOK_SECRET_CONNECT);
  }

  @Post('platform')
  @HttpCode(200)
  platform(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    return this.receive(req, this.env.STRIPE_WEBHOOK_SECRET_PLATFORM);
  }

  private async receive(req: RawBodyRequest<Request>, secret: string): Promise<{ received: true }> {
    const event = this.verify(req, secret);
    const { processedAt } = await this.prisma.stripeEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type, account: event.account ?? null },
      update: {},
    });
    if (processedAt) return { received: true };

    await this.handle(event); // throws → 500 → Stripe retries; handlers are idempotent
    await this.prisma.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { received: true };
  }

  private async handle(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'account.updated': {
        const accountId = event.account ?? event.data.object.id;
        // Read the live account rather than the payload, so out-of-order delivery cannot regress it.
        const merchant = await this.merchants.syncAccount(accountId);
        if (!merchant) this.logger.warn(`account.updated for unknown account ${accountId}`);
        return;
      }
      // Payment methods follow the connected account's settings, so delayed ones (bank debits) can occur: a session
      // completes unpaid and the money arrives (or fails) later in an async_payment event.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.checkout.completed(event.data.object, event.account);
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        return this.checkout.expired(event.data.object, event.account);
      default:
        return; // recorded; refund and dispute handlers arrive in M6
    }
  }

  private verify(req: RawBodyRequest<Request>, secret: string): Stripe.Event {
    const signature = req.headers['stripe-signature'];
    if (!secret || typeof signature !== 'string' || !req.rawBody) {
      throw new AppError('BAD_REQUEST', 'Invalid webhook signature');
    }
    try {
      return this.stripe.constructEvent(req.rawBody, signature, secret);
    } catch {
      throw new AppError('BAD_REQUEST', 'Invalid webhook signature');
    }
  }
}
