import Stripe from 'stripe';
import { AppError } from '../../../src/common/errors/app-error.js';
import type { CheckoutRequest, StripeAccountState, StripeClient, StripeRefund } from '../../../src/modules/stripe/stripe-client.js';

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
  /** Every refund Stripe holds, ours and the Dashboard's, by id. */
  readonly stripeRefunds = new Map<string, StripeRefund & { accountId: string; paymentIntentId: string }>();
  /** Stripe forgets idempotency keys after 24 h: a repeated key then creates a new refund. */
  keysExpired = false;
  /** The status a new refund starts in ('pending' as with an insufficient balance). */
  newRefundStatus = 'succeeded';
  failCheckout = false;
  failExpire = false;
  /** Stripe's refund API is down: create, retrieve and list all fail. */
  failRefund = false;
  /** Refunds whose Refund row id is listed keep failing until it is removed. */
  readonly failRefundKeys = new Set<string>();
  /** Like Stripe while the first request with the same idempotency key is still running. */
  checkoutInUse = false;

  /** Refunds created through refundPayment, in order (a replayed idempotency key adds none, as at Stripe). */
  get refunds(): { accountId: string; paymentIntentId: string; amountCents: number; idempotencyKey: string }[] {
    return [...this.stripeRefunds.values()]
      .filter((r) => r.refundId)
      .map((r) => ({ accountId: r.accountId, paymentIntentId: r.paymentIntentId, amountCents: r.amountCents, idempotencyKey: `refund:${r.refundId}` }));
  }

  /** What a charge.refunded event reports: the total Stripe has refunded on the payment. */
  amountRefunded(paymentIntentId: string): number {
    return [...this.stripeRefunds.values()].filter((r) => r.paymentIntentId === paymentIntentId && r.status === 'succeeded').reduce((n, r) => n + r.amountCents, 0);
  }

  reset(): void {
    this.sessions.length = 0;
    this.expired.length = 0;
    this.stripeRefunds.clear();
    this.newRefundStatus = 'succeeded';
    this.keysExpired = false;
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

  async refundPayment(accountId: string, paymentIntentId: string, amountCents: number, refundId: string): Promise<StripeRefund> {
    if (this.failRefund || this.failRefundKeys.has(refundId)) throw stripeError('api_error');
    const replay = this.keysExpired ? undefined : [...this.stripeRefunds.values()].find((r) => r.refundId === refundId);
    if (replay) return this.view(replay); // same idempotency key
    const id = `re_${refundId.replace(/[^a-z0-9]/gi, '').slice(-12)}_${this.stripeRefunds.size}`;
    this.stripeRefunds.set(id, { id, status: this.newRefundStatus, amountCents, refundId, accountId, paymentIntentId });
    return this.view(this.stripeRefunds.get(id)!);
  }

  async retrieveRefund(accountId: string, stripeRefundId: string): Promise<StripeRefund> {
    if (this.failRefund) throw stripeError('api_error');
    const r = this.stripeRefunds.get(stripeRefundId);
    if (!r || r.accountId !== accountId) throw stripeError('resource_missing');
    return this.view(r);
  }

  async listRefunds(accountId: string, paymentIntentId: string): Promise<StripeRefund[]> {
    if (this.failRefund) throw stripeError('api_error');
    return [...this.stripeRefunds.values()].filter((r) => r.accountId === accountId && r.paymentIntentId === paymentIntentId).map((r) => this.view(r));
  }

  /** A refund the merchant made in the Stripe Dashboard (no metadata). */
  dashboardRefund(accountId: string, paymentIntentId: string, amountCents: number): string {
    const id = `re_dash_${this.stripeRefunds.size}`;
    this.stripeRefunds.set(id, { id, status: 'succeeded', amountCents, refundId: null, accountId, paymentIntentId });
    return id;
  }

  /** Stripe settling a pending refund later. */
  settleRefund(stripeRefundId: string, status: 'succeeded' | 'failed'): void {
    this.stripeRefunds.get(stripeRefundId)!.status = status;
  }

  private view(r: StripeRefund): StripeRefund {
    return { id: r.id, status: r.status, amountCents: r.amountCents, refundId: r.refundId };
  }

  constructEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
    return sdk.webhooks.constructEvent(rawBody, signature, secret);
  }
}
