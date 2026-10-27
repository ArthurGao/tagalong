import Stripe from 'stripe';
import { AppError } from '../../common/errors/app-error.js';
import { callStripe } from './stripe-client.js';

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
