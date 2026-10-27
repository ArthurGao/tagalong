import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';

export interface CheckoutLine {
  name: string;
  unitAmountCents: number;
  quantity: number;
}

export interface CheckoutRequest {
  accountId: string;
  orderId: string;
  lines: CheckoutLine[];
  applicationFeeCents: number;
  customerEmail: string;
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
  locale: string;
}

export interface StripeAccountState {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

/** SDK failures become 502 STRIPE_ERROR with `details.stripeCode` (DESIGN §17); Stripe's message stays in logs. */
export async function callStripe<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      throw new AppError('STRIPE_ERROR', 'Stripe request failed', { stripeCode: e.code ?? e.rawType ?? e.type });
    }
    throw e;
  }
}

// Business code never touches the SDK class (backend/CLAUDE.md); tests swap this token for a fake.
export abstract class StripeClient {
  abstract createConnectedAccount(merchantId: string, email: string): Promise<string>;
  abstract createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  abstract retrieveAccount(accountId: string): Promise<StripeAccountState>;
  /** Direct charge on the merchant's account (D2); idempotent per order. */
  abstract createCheckoutSession(request: CheckoutRequest): Promise<{ id: string; url: string }>;
  /** Ends an open session; a session that is already complete or expired is not an error. */
  abstract expireCheckoutSession(accountId: string, sessionId: string): Promise<void>;
  /** Full or partial refund on the merchant's account; `idempotencyKey` makes retries safe. */
  abstract refundPayment(
    accountId: string,
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string }>;
  /** Verifies the signature against the raw body; throws when it does not match. */
  abstract constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event;
}

@Injectable()
export class StripeSdkClient extends StripeClient {
  private readonly stripe: Stripe;

  constructor(@Inject(ENV) env: Env) {
    super();
    // An empty key only fails calls that reach Stripe; webhook verification is local HMAC.
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_unset');
  }

  async createConnectedAccount(merchantId: string, email: string): Promise<string> {
    // D2: the merchant gets the full Dashboard and carries fees and losses (the "Standard" set).
    const account = await callStripe(() =>
      this.stripe.accounts.create(
      {
        country: 'NZ',
        email,
        controller: {
          stripe_dashboard: { type: 'full' },
          fees: { payer: 'account' },
          losses: { payments: 'stripe' },
          requirement_collection: 'stripe',
        },
        metadata: { merchantId },
      },
      // Retries of the same onboarding never create a second account.
      { idempotencyKey: `connect-account:${merchantId}` },
      ),
    );
    return account.id;
  }

  async createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    const link = await callStripe(() =>
      this.stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: refreshUrl,
        return_url: returnUrl,
      }),
    );
    return link.url;
  }

  async retrieveAccount(accountId: string): Promise<StripeAccountState> {
    const account = await callStripe(() => this.stripe.accounts.retrieve(accountId));
    return {
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  async createCheckoutSession(r: CheckoutRequest): Promise<{ id: string; url: string }> {
    const session = await callStripe(() =>
      this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          currency: 'nzd',
          // Built from database prices by the caller; never from the client (root CLAUDE.md rule 3).
          line_items: r.lines.map((l) => ({
            quantity: l.quantity,
            price_data: { currency: 'nzd', unit_amount: l.unitAmountCents, product_data: { name: l.name } },
          })),
          payment_intent_data: { application_fee_amount: r.applicationFeeCents, metadata: { orderId: r.orderId } },
          metadata: { orderId: r.orderId },
          customer_email: r.customerEmail,
          expires_at: Math.floor(r.expiresAt.getTime() / 1000),
          success_url: r.successUrl,
          cancel_url: r.cancelUrl,
          locale: r.locale === 'en' ? 'en' : 'zh',
        },
        { stripeAccount: r.accountId, idempotencyKey: `checkout:${r.orderId}` },
      ),
    );
    if (!session.url) throw new AppError('STRIPE_ERROR', 'Checkout session has no URL', { stripeCode: 'no_url' });
    return { id: session.id, url: session.url };
  }

  async expireCheckoutSession(accountId: string, sessionId: string): Promise<void> {
    const session = await callStripe(() => this.stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId }));
    if (session.status !== 'open') return;
    await callStripe(() => this.stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId }));
  }

  async refundPayment(
    accountId: string,
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string }> {
    const refund = await callStripe(() =>
      this.stripe.refunds.create(
        // DESIGN §8.4: the platform fee is returned with the refund.
        { payment_intent: paymentIntentId, amount: amountCents, refund_application_fee: true },
        { stripeAccount: accountId, idempotencyKey },
      ),
    );
    return { id: refund.id, status: refund.status ?? 'pending' };
  }

  constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}
