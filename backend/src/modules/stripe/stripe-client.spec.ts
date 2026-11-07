import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { AppError } from '../../common/errors/app-error.js';
import { callStripe, isStripeRejection } from './stripe-client.js';

describe('callStripe', () => {
  it('turns SDK errors into 502 STRIPE_ERROR with the Stripe code (DESIGN §17)', async () => {
    const sdkError = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      message: 'No such account: acct_123',
    });
    const error = await callStripe(() => Promise.reject(sdkError)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'STRIPE_ERROR', httpStatus: 502, details: { stripeCode: 'resource_missing' } });
    expect((error as AppError).message).not.toContain('acct_123');
  });

  it("logs Stripe's own message (redacted) so a misconfiguration is visible, not just a 502", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const sdkError = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: "You can only create new accounts if you've signed up for Connect (merchant amy@example.test)",
      requestId: 'req_123',
    } as never);
    await callStripe(() => Promise.reject(sdkError)).catch(() => {});
    expect(warn).toHaveBeenCalledWith(
      "Stripe request failed: invalid_request_error / StripeInvalidRequestError (req_123): You can only create new accounts if you've signed up for Connect (merchant [email])",
    );
    warn.mockRestore();
  });

  it('falls back to the error class when Stripe sends no code (e.g. a network failure)', async () => {
    const sdkError = new Stripe.errors.StripeConnectionError({ message: 'socket hang up' });
    await expect(callStripe(() => Promise.reject(sdkError))).rejects.toMatchObject({
      details: { stripeCode: 'StripeConnectionError' },
    });
  });

  it('passes other errors and successful results through', async () => {
    const bug = new TypeError('bug');
    await expect(callStripe(() => Promise.reject(bug))).rejects.toBe(bug);
    await expect(callStripe(() => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('isStripeRejection', () => {
  const failWith = (sdkError: Error) => callStripe(() => Promise.reject(sdkError)).catch((e: unknown) => e);
  const answered = (statusCode: number) =>
    new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'x', statusCode } as never);

  it.each([
    [400, true],
    [402, true],
    [404, true],
    [409, false], // the same key still in flight
    [429, false], // rate limited: nothing decided
    [500, false], // Stripe may have done the work
  ])('a Stripe answer with HTTP %s is a refusal: %s', async (statusCode, refused) => {
    expect(isStripeRejection(await failWith(answered(statusCode)))).toBe(refused);
  });

  it('is never a network failure (Stripe may have done the work) or an error that is not from Stripe', async () => {
    expect(isStripeRejection(await failWith(new Stripe.errors.StripeConnectionError({ message: 'socket hang up' })))).toBe(false);
    expect(isStripeRejection(new AppError('NOT_FOUND', 'x'))).toBe(false);
  });
});
