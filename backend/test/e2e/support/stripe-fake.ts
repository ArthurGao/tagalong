import Stripe from 'stripe';
import { AppError } from '../../../src/common/errors/app-error.js';
import type { CheckoutRequest, StripeAccountState, StripeClient } from '../../../src/modules/stripe/stripe-client.js';

// Webhook signing/verification is pure HMAC in the SDK; no network and no real key involved.
const sdk = new Stripe('sk_test_fake_for_webhook_signing');

export function signStripeEvent(event: object, secret: string): { body: string; signature: string } {
  const body = JSON.stringify(event);
  return { body, signature: sdk.webhooks.generateTestHeaderString({ payload: body, secret }) };
}

const stripeError = (stripeCode: string) => new AppError('STRIPE_ERROR', 'Stripe request failed', { stripeCode });
const sessionIdFor = (orderId: string) => `cs_test_${orderId.replace(/-/g, '').slice(-16)}`;
const checkoutUrlFor = (sessionId: string) => `https://checkout.stripe.test/${sessionId}`;

export class FakeStripeClient implements StripeClient {
  readonly createdFor: string[] = [];
  readonly links: { accountId: string; refreshUrl: string; returnUrl: string }[] = [];
  readonly retrieveCalls: string[] = [];
  readonly accounts = new Map<string, StripeAccountState>();
  /** Per-call delays (ms) for retrieveAccount; the state is read when the call starts, like a real request. */
  readonly retrieveDelays: number[] = [];
  failNextRetrieve = false;
  readonly sessions: CheckoutRequest[] = [];
  readonly expired: { accountId: string; sessionId: string }[] = [];
  readonly refunds: { accountId: string; paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
  failCheckout = false;
  failExpire = false;
  failRefund = false;
  /** Refunds whose idempotency key is listed keep failing until it is removed. */
  readonly failRefundKeys = new Set<string>();
  /** Like Stripe while the first request with the same idempotency key is still running. */
  checkoutInUse = false;

  reset(): void {
    this.sessions.length = 0;
    this.expired.length = 0;
    this.refunds.length = 0;
    this.failCheckout = false;
    this.failExpire = false;
    this.failRefund = false;
    this.failRefundKeys.clear();
    this.checkoutInUse = false;
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

  async createCheckoutSession(request: CheckoutRequest): Promise<{ id: string; url: string }> {
    if (this.failCheckout) throw stripeError('api_error');
    if (this.checkoutInUse) throw stripeError('idempotency_key_in_use');
    // Like Stripe: reusing an idempotency key (checkout:{orderId}) with different parameters is an error,
    // and an identical retry returns the stored response without validating again.
    const earlier = this.sessions.find((s) => s.orderId === request.orderId);
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(request)) {
      throw stripeError('idempotency_error');
    }
    // Like Stripe: a session must stay open for at least 30 minutes from its creation.
    if (!earlier && request.expiresAt.getTime() - Date.now() < 30 * 60_000) {
      throw stripeError('parameter_invalid_integer');
    }
    this.sessions.push(request);
    const id = sessionIdFor(request.orderId);
    return { id, url: checkoutUrlFor(id) };
  }

  async retrieveCheckoutUrl(accountId: string, sessionId: string): Promise<string | null> {
    const request = this.sessions.find((s) => sessionIdFor(s.orderId) === sessionId);
    if (!request || request.accountId !== accountId) throw stripeError('resource_missing');
    return this.expired.some((e) => e.sessionId === sessionId) ? null : checkoutUrlFor(sessionId);
  }

  async expireCheckoutSession(accountId: string, sessionId: string): Promise<void> {
    if (this.failExpire) throw stripeError('api_error');
    this.expired.push({ accountId, sessionId });
  }

  async refundPayment(accountId: string, paymentIntentId: string, amountCents: number, idempotencyKey: string) {
    if (this.failRefund || this.failRefundKeys.has(idempotencyKey)) throw stripeError('api_error');
    this.refunds.push({ accountId, paymentIntentId, amountCents, idempotencyKey });
    return { id: `re_${idempotencyKey.replace(/[^a-z0-9]/gi, '').slice(-16)}`, status: 'succeeded' };
  }

  constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
    return sdk.webhooks.constructEvent(rawBody, signature, secret);
  }
}
