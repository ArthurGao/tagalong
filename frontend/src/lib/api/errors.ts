// Every code in DESIGN §17 (mirrored by backend/src/common/errors/error-codes.ts; a test keeps them equal).
// The UI switches on `code`, never on `message`; messages live under `errors.*` in messages/*.json.
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'TURNSTILE_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'LISTING_NOT_PUBLISHED',
  'LISTING_CLOSED',
  'MERCHANT_SUSPENDED',
  'MERCHANT_PROFILE_EXISTS',
  'SLUG_TAKEN',
  'MERCHANT_NOT_CHARGEABLE',
  'SOLD_OUT',
  'ALREADY_REGISTERED',
  'QTY_EXCEEDS_LIMIT',
  'INVALID_STATE_TRANSITION',
  'ORDER_IN_PROGRESS',
  'FIELD_LOCKED_AFTER_PUBLISH',
  'CAPACITY_BELOW_SOLD',
  'OPTION_HAS_ORDERS',
  'PICKUP_POINT_HAS_ORDERS',
  'LISTING_STALE',
  'SELF_CANCEL_WINDOW_PASSED',
  'REFUND_EXCEEDS_TOTAL',
  'ANONYMIZE_BLOCKED',
  'PRICE_OUT_OF_RANGE',
  'RATE_LIMITED',
  'STRIPE_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** i18n key under `errors.` for an API error code; unknown codes fall back to INTERNAL. */
export function errorMessageKey(code: unknown): ErrorCode {
  return (ERROR_CODES as readonly unknown[]).includes(code) ? (code as ErrorCode) : 'INTERNAL';
}
