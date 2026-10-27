import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';

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

  constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}
