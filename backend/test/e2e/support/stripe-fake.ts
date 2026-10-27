import Stripe from 'stripe';
import type { StripeAccountState, StripeClient } from '../../../src/modules/stripe/stripe-client.js';

// Webhook signing/verification is pure HMAC in the SDK; no network and no real key involved.
const sdk = new Stripe('sk_test_fake_for_webhook_signing');

export function signStripeEvent(event: object, secret: string): { body: string; signature: string } {
  const body = JSON.stringify(event);
  return { body, signature: sdk.webhooks.generateTestHeaderString({ payload: body, secret }) };
}

export class FakeStripeClient implements StripeClient {
  readonly createdFor: string[] = [];
  readonly links: { accountId: string; refreshUrl: string; returnUrl: string }[] = [];
  readonly retrieveCalls: string[] = [];
  readonly accounts = new Map<string, StripeAccountState>();
  /** Per-call delays (ms) for retrieveAccount; the state is read when the call starts, like a real request. */
  readonly retrieveDelays: number[] = [];
  failNextRetrieve = false;

  reset(): void {
    this.createdFor.length = 0;
    this.links.length = 0;
    this.retrieveCalls.length = 0;
    this.accounts.clear();
    this.retrieveDelays.length = 0;
    this.failNextRetrieve = false;
  }

  async createConnectedAccount(merchantId: string): Promise<string> {
    this.createdFor.push(merchantId);
    const id = `acct_${merchantId.replace(/-/g, '').slice(-12)}`;
    this.accounts.set(id, { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    return id;
  }

  async createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    this.links.push({ accountId, refreshUrl, returnUrl });
    return `https://connect.stripe.test/setup/${accountId}`;
  }

  async retrieveAccount(accountId: string): Promise<StripeAccountState> {
    this.retrieveCalls.push(accountId);
    if (this.failNextRetrieve) {
      this.failNextRetrieve = false;
      throw new Error('Stripe API unavailable');
    }
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`No such account: ${accountId}`);
    const snapshot = { ...account };
    await new Promise((resolve) => setTimeout(resolve, this.retrieveDelays.shift() ?? 0));
    return snapshot;
  }

  constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
    return sdk.webhooks.constructEvent(rawBody, signature, secret);
  }
}
