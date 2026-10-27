# CLAUDE.md — backend (NestJS)

The global rules in the root `CLAUDE.md` and in `docs/DESIGN.md` apply here too. This file adds backend-specific conventions.

## Layout

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                 # demo merchant + listings for local dev
├── src/
│   ├── main.ts                 # rawBody: true, global prefix /api/v1, ValidationPipe, Swagger, cookie-parser
│   ├── app.module.ts
│   ├── config/                 # env schema (zod), typed ConfigService wrapper; fail fast on missing vars
│   ├── prisma/                 # PrismaService, transaction helper
│   ├── common/
│   │   ├── errors/             # AppError(code, httpStatus), global exception filter → { code, message, details }
│   │   ├── money.ts            # cents helpers, fee calc (bps)
│   │   ├── ids.ts              # shortCode, publicCode, accessToken generators (crypto)
│   │   ├── mask.ts             # name masking (DESIGN §10)
│   │   └── rate-limit/         # @nestjs/throttler config
│   └── modules/
│       ├── health/
│       ├── auth/
│       │   ├── clerk.ts            # ClerkVerifier / ClerkAdminApi abstractions (DI tokens) + SDK implementations
│       │   ├── clerk-auth.guard.ts # ClerkAuthGuard (verifyToken, networkless) → req.user
│       │   ├── auth.decorator.ts   # @Auth(...roles) = ClerkAuthGuard + RolesGuard; @CurrentUser()
│       │   ├── admin-role.service.ts        # backs the admin:grant / admin:revoke CLI (src/cli/admin-role.ts)
│       │   ├── admin-sign-in.service.ts     # session.created → ADMIN_SIGN_IN audit + outbox alert per admin
│       │   ├── roles.guard.ts      # @Roles('ADMIN') — reads role from DB, not from JWT
│       │   ├── clerk-webhook.controller.ts  # svix-verified user.* and session.created
│       │   └── user-sync.service.ts         # upsert by clerkUserId + mirror publicMetadata.role
│       ├── merchants/
│       ├── stripe/             # StripeClient provider (injectable, mockable), connect onboarding, webhook controller + dispatcher
│       ├── listings/           # merchant CRUD + public read
│       ├── listings/           # + listing-state-machine.ts, listing-close.job.ts, publish-rules.ts (DESIGN §5b)
│       ├── orders/             # orders.service, reservation.service, order-state-machine.ts, expiry.job.ts, refunds
│       ├── cancellations/      # ListingCancellation + RefundTask, refund.job.ts (DESIGN §8.5)
│       ├── notifications/      # enqueue() → NotificationOutbox, outbox.job.ts, EmailService impls, templates, ics
│       ├── uploads/            # S3/R2 presign
│       └── admin/              # suspend merchant, take down listing
└── test/
    ├── e2e/                    # supertest + Testcontainers Postgres (support/global-setup.ts runs migrate deploy), *.e2e-spec.ts; files run serially and truncate between tests
    └── fixtures/
```

## Tooling

- The package is **ESM** (`"type": "module"`, `module: nodenext`) because NestJS 12 ships ESM only. Relative imports end in `.js` (`import { AppError } from './app-error.js'`).
- Tests run on **Vitest** with `unplugin-swc` (SWC keeps the decorator metadata Nest's DI needs; esbuild drops it). `vitest.config.ts` defines two projects: `pnpm test` runs `unit` (`src/**/*.spec.ts`), `pnpm test:e2e` runs `e2e` (`test/**/*.e2e-spec.ts`, with its env set in the config).
- `src/load-env.ts` loads `.env` and stays the **first** import of `main.ts`. Nothing reads `process.env` directly: modules inject the parsed `Env` (`ENV` token), e.g. `LoggerModule.forRootAsync`.
- `src/app.setup.ts` owns app creation: `APP_OPTIONS`, `createApp()` (main, OpenAPI export), `configureApp()` (also used by e2e), `buildOpenApiDocument()`.
- Prisma 7 reads the database URL from `prisma.config.ts`, not from `schema.prisma`; the client is generated into `src/generated/prisma` (M1).

## Listings and uploads

- Pure rules live next to the module: `listing-state-machine.ts` (§5b transitions), `publish-rules.ts` (locked fields, capacity, option deletion, price ranges, publish checks, defaults), `form-fields.ts` (≤10 fields, sensitive-label warnings). The service only loads data and calls them.
- Every change to an existing listing goes through `ListingsService.mutate()`: `SELECT … FOR UPDATE` on the row, `LISTING_STALE` if the request's `revision` is older, validation against the locked state, then the write with `revision + 1`. The close job bumps `revision` too.
- `availability.ts` (listings module) is the one answer to "can this listing take orders now?" (`OPEN | NOT_YET_OPEN | SOLD_OUT | CLOSED | CANCELLED | TAKEN_DOWN | SUSPENDED`) plus `remainingPlaces()`. The public read API (`modules/public/`) and order creation both use it.
- `reopen` accepts only CLOSED and re-runs the publish checks. Pickup point deletion relies on the `RESTRICT` foreign key (P2003 → `PICKUP_POINT_HAS_ORDERS`).
- `listing-close.job.ts` is one conditional UPDATE every minute. Jobs know nothing about tests: `createTestApp` stops every registered cron after init, and tests call the job method (`closeDue()`) directly.
- `ObjectStorage` (`modules/uploads/object-storage.ts`) presigns a PUT with `Content-Length` signed (R2 has no POST policies) and owns the key layout (`merchantImageKey`, `isMerchantImage`); e2e tests use `test/e2e/support/storage-fake.ts`.
- `formFields` is a Json column: cross that boundary only through `readFormFields` / `toFormFieldsJson` in `form-fields.ts`.

## Orders and notifications

- `modules/orders/`:
  - `order-state-machine.ts`: `transitionOrder(tx, order, to, data)` is the only status write. It is a conditional `updateMany` on the expected status, so a concurrent change fails instead of overwriting.
  - `reservation.ts`: `reserve` / `release` / `sell` are raw conditional UPDATEs.
    - **Lock order everywhere:** order row → listing row → options by id, the same as `ListingsService.mutate()` (listing, then options). Inverting it deadlocked in tests.
    - `reserve` locks the listing (`FOR UPDATE`, merchant `FOR SHARE`) and runs `assertOrderable(availabilityOf(...))` on the locked rows, so the public page's rules decide and a close or suspension mid-request cannot slip through.
    - `sellAfresh` owns the savepoint for a late payment and returns null when sold out.
    - Listing counters (`sold_count`, `reserved_count`) always move with the options, and `sell` returns the next `paid_seq`.
    - Order creation retries deadlocks and serialization failures (`isRetryableTransactionError`).
  - `order-ops.ts`: the shared steps. `orderDetail` include, `lockOrder` (FOR UPDATE + load), `endUnpaid` (→ EXPIRED/CANCELLED + release), `sessionsToEnd` / `expireSessions`, and `checkoutRequest(env, order)`, which builds the Checkout request from the stored order only, so a replay is byte-identical.
  - `availability.ts`: `assertOrderable` maps each non-OPEN state to its error code (exhaustive).
  - `orders.service.ts`: create, replay, status and cancel.
  - `checkout-webhooks.service.ts`: `completed` / `expired`.
  - `expiry.job.ts`.
- **Order creation:**
  - validate against the DB (prices from options only);
  - in one tx: expire the same email's unpaid order, reserve, create;
  - **after commit**, create the Checkout session (Stripe idempotency key `checkout:{orderId}`).
  - If Stripe fails, the order is expired, its stock released and its `idempotencyKey` cleared, so the buyer's retry starts afresh.
  - Only a Stripe error rolls the order back. If saving the session id fails afterwards, the order stays pending: a replay or the payment webhook recovers the session from Stripe (`recoverCheckoutSession`, same idempotency key). The event's session id is never trusted.
  - Checkout `expires_at` = `reservationExpiresAt` + 2 min (Stripe needs 30 min from creation); derived, so replays match.
  - **Replay:** with a saved session it reads the URL back (`retrieveCheckoutUrl`); without one it resends the stored request under the same key. Stripe's `idempotency_key_in_use` → `ORDER_IN_PROGRESS`.
- **Webhooks:** each one locks the order row and applies only the transition that still applies.
  - An event counts only for the order's own connected account and Checkout session (and, for `completed`, its amount in NZD). Otherwise it is ignored with a warning: a valid signature does not prove the payment is for this order.
  - **Async payments:** `async_payment_succeeded` is handled like a paid `completed`, and `async_payment_failed` like `expired`. Payment methods follow the connected account's settings, and this API version cannot restrict them from Checkout.
  - **Late refunds:** the decision is a `Refund` row (`PENDING`, no `stripeRefundId`) written under the order lock before Stripe is called; a later delivery only resumes it. Stripe's answer fills the id, and only then does `refundedCents` move.
  - **EXPIRED + completed:** `sell(…, fromReserved=false)` inside a savepoint.
    - Places still free → PAID.
    - SOLD_OUT → full refund after the tx (`late-refund:{orderId}`), recorded once via the Refund row; the order stays EXPIRED.
  - **CANCELLED + completed:** refunded the same way.
- **Notifications:**
  - `NotificationsService.enqueue(tx, …)` writes `notification_outbox` with `skipDuplicates`. The dedupe key is `TYPE:{id}`.
  - `outbox.job.ts` claims a batch with a 5-minute lease (`SKIP LOCKED`) and sends outside the tx.
  - Retries follow 1/5/30 min, 2 h, 12 h; the 6th failure → FAILED. A missing template → FAILED at once.
  - `EmailService`: SMTP (Mailpit) or Resend by `EMAIL_PROVIDER`. e2e tests use `test/e2e/support/email-fake.ts`.
  - Templates live in `templates.ts`, are short and bilingual, and escape everything. The buyer's language is `order.locale`.
- **Free registration (M5b):**
  - `reservation.registerFree` goes straight to sold (same lock-and-check as `reserve`); `releaseSold` gives the places back when a registration is cancelled (by the buyer within `selfCancelUntil`, or by the merchant).
  - `onePerEmail` is enforced twice: an up-front check (which re-sends the confirmation, once an hour, and answers `ALREADY_REGISTERED`) and the partial unique index as the race backstop.
  - Custom-field answers go through `form-fields.answerIssues` for paid and free orders alike.
- **Abuse controls:**
  - `common/security/turnstile.ts` `TurnstileVerifier` checks the token on every new order, after the idempotency replay; it fails closed. e2e tests use `test/e2e/support/turnstile-fake.ts`.
  - `ThrottlerGuard` on order creation limits each IP (`ORDER_RATE_LIMIT_PER_MINUTE`).
  - `TRUST_PROXY` decides which hops may set X-Forwarded-For.
- **Refunds (M6):**
  - Every merchant and cancellation refund writes a `PENDING` Refund row under the order lock first (`refunds.refundable` = total − refunded − pending, pending via `pendingByOrder`), calls Stripe with the row id as idempotency key, then `refunds.confirmRefund` records Stripe's answer once and `settleRefund` moves `refundedCents` and the status (where the state machine allows) and queues ORDER_REFUNDED.
  - The late-payment refund above is the exception: it keeps the order EXPIRED/CANCELLED and sends ORDER_AUTO_REFUNDED.
  - A Stripe error marks the row FAILED.
  - `charge.refunded` adds only the unrecorded remainder (Dashboard refunds).
  - `charge.dispute.created` emails the merchant (MERCHANT_DISPUTE).
- **Listing cancellation (§8.5):** `cancellation.service.ts`.
  - It locks the listing's orders, then the listing.
  - The listing becomes CANCELLED, unpaid checkouts EXPIRED, free registrations CANCELLED (with an email).
  - Each PAID / PARTIALLY_REFUNDED order gets one `RefundTask` plus a Refund with the **same id**.
  - `refund.job.ts`: every 30 s, 20 tasks, lease plus SKIP LOCKED; retries after 1/2/4/8 min; FAILED after 5 attempts. A cancellation with nothing pending becomes COMPLETED(_WITH_FAILURES) and the merchant is emailed.
  - `retryFailed()` is for the admin console (M8).
- `orders-csv.ts` builds the merchant CSV (pure, one column table; BOM, CRLF, formula-safe cells).
- `merchant-orders.*`: the merchant's list (`?status=&q=`), fulfil (check-in or hand-over), cancel (free only, emails the reason) and no-show (only after the event starts).
- `StripeClient` lives in `StripeClientModule`, so orders and the Stripe module can both inject it without a cycle.

## Security

- `OriginGuard` (global `APP_GUARD`, `src/common/security/origin.guard.ts`): unsafe requests that carry cookies, and every `/public/` write, must send an `Origin` from `APP_URL` / `CLERK_AUTHORIZED_PARTIES`, or get 403.

## Prisma conventions

- Models are `PascalCase`, tables and columns are `snake_case` via `@@map` / `@map`. Enums are `SCREAMING_SNAKE`.
- Every model has `id` (uuid v7 or cuid2), `createdAt`, `updatedAt`. Soft delete uses `deletedAt?` only where DESIGN says so.
- Money columns are `Int` and end in `Cents`. Timestamps are `DateTime` (UTC).
- Partial unique indexes and `FOR UPDATE SKIP LOCKED` are written in raw SQL inside the migration file; after `prisma migrate dev`, edit the generated SQL and commit it.
- Migration rules: never edit an applied migration; never use `db push` outside local; every migration is reviewed for locks on big tables (add indexes `CONCURRENTLY` once there is real data).

## Module conventions

- Each module has a controller, a service and DTOs. Controllers stay thin: validate input, call the service, map the result.
- DTOs use class-validator decorators and `@ApiProperty`. Response DTOs are explicit classes; never return Prisma models directly, so that PII doesn't leak.
- Business errors throw `AppError` with a `code` from the catalog in DESIGN §17. Adding a code means adding it to DESIGN first. The frontend switches on `code`, never on `message`.
- **Notifications never send inline.** Call `notifications.enqueue()` inside the business transaction; only `outbox.job.ts` talks to the email provider.
- **Public order creation is idempotent** via the `Idempotency-Key` header (DESIGN §7.2).
- Wrap multi-step writes in `prisma.$transaction`. Use raw SQL (`$queryRaw` / `$executeRaw`) for the conditional stock update and the sequence increment (`UPDATE listing SET paid_seq = paid_seq + 1 ... RETURNING paid_seq`).
- Business logic must never depend directly on the `Stripe` SDK class. Inject `StripeClient`, a thin wrapper, so tests can mock it.

## Stripe specifics

- `StripeClient` (`src/modules/stripe/stripe-client.ts`) is the only place that touches the SDK; e2e tests override it with `test/e2e/support/stripe-fake.ts`, whose `signStripeEvent()` signs webhook bodies with the SDK's own HMAC helper.
- Every SDK call goes through `callStripe()`, which turns Stripe errors into `502 STRIPE_ERROR` with `details.stripeCode`.
- `syncAccount` holds a transaction-scoped advisory lock per account across the Stripe read and the write, so concurrent webhook/status syncs apply in order.
- Connected accounts use the Standard controller set and the idempotency key `connect-account:{merchantId}`; `account.updated` and `GET …/stripe/status` re-read the live account (`syncAccount`) instead of trusting the payload, so out-of-order events are harmless.
- Call `checkout.sessions.create`, `refunds.create` and `checkout.sessions.expire` with `{ stripeAccount }` (direct charges).
- The webhook controller reads `req.rawBody` and verifies it with the correct secret (`STRIPE_WEBHOOK_SECRET_CONNECT` or `STRIPE_WEBHOOK_SECRET_PLATFORM`).
- The dispatcher works in four steps:
  1. Insert the event into `StripeEvent` with `ON CONFLICT DO NOTHING`.
  2. If its `processedAt` is already set → return 200. (A row without `processedAt` is a previous attempt that threw; process it again.)
  3. Route the event by `type`.
  4. Set `processedAt`.
- If a handler throws, return 500 so that Stripe retries.
- Handlers look up the order by `metadata.orderId`. An unknown order means: log a warning and return 200.
- Handle the late-payment-after-expiry case exactly as DESIGN §7.5 describes.

## Auth

Merchants and admins share **one Clerk application** and are distinguished by role (DESIGN D13, §9).

- **Guard:** `ClerkAuthGuard` verifies the Clerk session JWT with `@clerk/backend` `verifyToken`:
  - verify networklessly with `jwtKey: CLERK_JWT_KEY`;
  - set `authorizedParties` to both the main and admin origins.
- **Token source:** read the `__session` cookie first, then fall back to `Authorization: Bearer`.
- **Request context:** after verification, attach `req.user = { id, clerkUserId, role }`. Load the role from the **DB**, never from the JWT claim.
- **RolesGuard:** `@Roles('ADMIN')` is applied at the class level on every controller in the `admin` module. Merchant endpoints require `MERCHANT`, so admins cannot create merchant profiles or listings.
- **JIT upsert:** if `clerkUserId` is unknown, create the User with role MERCHANT, then set Clerk `publicMetadata.role = 'merchant'` via the Backend API.
- **Webhook:** `POST /webhooks/clerk` verifies the Svix signature (`CLERK_WEBHOOK_SIGNING_SECRET`) against the raw body. It handles:
  - `user.created`, `user.updated` and `user.deleted`, as idempotent upserts keyed by `clerkUserId`;
  - `session.created`: if the user is an ADMIN, write an `ADMIN_SIGN_IN` audit entry and email all admins.
- **User sync is order-tolerant:** `user.deleted` before the user exists leaves a deleted tombstone row; `user.*` events older than `User.clerkUpdatedAt` are ignored; email is unique among live users only (partial index), so a deleted account's email can sign up again.
- **Role changes:** go only through the CLI (`src/cli/admin-role.ts`, via `pnpm admin:grant` / `admin:revoke`). The DB role and its AuditLog row commit in one transaction; the Clerk mirror runs after it and a failure is audited as `ADMIN_ROLE_CLERK_SYNC_FAILED` (re-run to retry). The order is: check `ADMIN_EMAIL_ALLOWLIST` → update the DB → update Clerk `publicMetadata.role` → write AuditLog. There is no HTTP endpoint that changes roles.
- **Metadata:** never read or write `unsafeMetadata` for anything security-related.
- **Testing:** hide the Clerk SDK behind `ClerkVerifier` and `ClerkAdminApi` interfaces so tests can mock them. Never call Clerk in tests. e2e tests use `test/e2e/support/app.ts` (`createTestApp`), which swaps both for fakes; a fake session token is `valid:<clerkUserId>`.
- **Env:** Clerk variables are required only when `NODE_ENV=production`; without `CLERK_JWT_KEY` every authenticated request gets 401, so local dev boots before keys exist.
- **svix 2.x:** `Webhook.verify()` only checks the signature and returns `undefined`; parse the raw body yourself after it passes.
- **Required tests:**
  - a merchant token gets 403 on every `/admin/*` route;
  - an admin token gets 403 on merchant-only write routes;
  - a revoked admin is rejected immediately, even while still holding a JWT with `role: admin`.

## Jobs

- All jobs follow the same shape: batch select with `FOR UPDATE SKIP LOCKED`, process, update, log a one-line summary. They are safe to run on multiple instances.
- `listing-close.job.ts` runs every minute and closes PUBLISHED listings whose `closesAt` has passed.
- `outbox.job.ts` runs every 10 seconds (DESIGN §12 backoff schedule).
- `refund.job.ts` runs every 30 seconds, 20 tasks per batch, with `RefundTask.id` as the Stripe idempotency key.
- `pii-retention.job.ts` runs daily and anonymizes buyer PII on orders whose listing ended more than 12 months ago.
- `reminder.job.ts` runs every 15 minutes. It sends event reminders for SESSION/EVENT orders and is idempotent via `Order.reminderSentAt`.
- `expiry.job.ts` runs every minute. It only applies to paid orders. It processes in batches, uses `FOR UPDATE SKIP LOCKED` so that multiple instances are safe, expires the Stripe session, then transitions the order to EXPIRED.

## Testing

- Unit tests (`*.spec.ts`) sit next to the code and cover services, the state machine, masking and fee calculation.
- e2e tests (`test/e2e`) run against real Postgres via Testcontainers, with `StripeClient` mocked.
- Required tests:
  - Concurrency: capacity 5, 50 parallel orders → exactly 5 succeed, and `soldCount + reservedCount` never exceeds capacity.
  - Webhook idempotency: the same event delivered twice produces one state change.
  - Every allowed and every disallowed transition in the state machine.
  - The late-payment-after-expiry path: re-reserve succeeds, and the auto-refund path.
  - Public endpoints never return email or phone.
  - **Free listings:**
    - concurrency: capacity 5, 50 parallel free registrations → exactly 5 CONFIRMED;
    - `onePerEmail` enforced, including email case-insensitivity;
    - self-cancel respects `selfCancelUntil` and releases capacity;
    - the state machine rejects PAID/REFUNDED transitions on free orders and CONFIRMED on paid orders.
  - Publishing: a PAID listing is rejected when `chargesEnabled=false`, and a FREE listing is allowed.
  - `formFields` validation: required fields, type checks, select options, and the attendee-scope answer count must match the quantity.
  - `formAnswers` and `attendeeAnswers` never appear in public responses.
  - Listing state machine: every allowed and disallowed transition; auto-close picks up a listing within one tick.
  - Publish rules (DESIGN §5b): each locked field, `CAPACITY_BELOW_SOLD`, `OPTION_HAS_ORDERS`, and that an option price change doesn't touch existing orders.
  - `totalCapacity` with the concurrency test: capacity 10 across two options, 50 parallel orders → sum sold is exactly 10.
  - Idempotency: the same `Idempotency-Key` twice creates one order and returns the same response.
  - Outbox: a failing email provider leaves the order PAID and the outbox row PENDING with `attempts=1`; `dedupeKey` prevents duplicate rows from a replayed webhook.
  - Cancellation: 50 paid orders with the Stripe mock failing on 5 → 45 SUCCEEDED, 5 FAILED after retries, status COMPLETED_WITH_FAILURES, and a retry succeeds.
  - Recover-order returns an identical response for known and unknown emails.
  - Anonymize: PII columns replaced, `accessToken` invalid, amounts unchanged.

## Commands

```bash
pnpm dev                 # nest start --watch on :3810
pnpm prisma:migrate      # prisma migrate dev (local only)
pnpm prisma:deploy       # prisma migrate deploy (CI, staging, production, e2e)
pnpm admin:grant <email> # src/cli/admin-role.ts: DB role → Clerk publicMetadata → AuditLog; email must be in ADMIN_EMAIL_ALLOWLIST
pnpm admin:revoke <email>
pnpm prisma:seed
pnpm test                # unit
pnpm test:e2e
pnpm openapi:export      # writes ../frontend/openapi.json (used by root gen:api)
```

## Env (.env.example must contain all of these)

```
DATABASE_URL=postgresql://tagalong:tagalong@localhost:5442/tagalong
APP_URL=http://localhost:3800
CLERK_SECRET_KEY=
CLERK_JWT_KEY=                # PEM public key from Clerk dashboard (networkless verification)
CLERK_AUTHORIZED_PARTIES=http://localhost:3800,http://admin.localhost:3800
CLERK_WEBHOOK_SIGNING_SECRET=
ADMIN_EMAIL_ALLOWLIST=           # comma-separated
STRIPE_SECRET_KEY=
TURNSTILE_SECRET_KEY=
ORDER_RATE_LIMIT_PER_MINUTE=10
TRUST_PROXY=loopback
STRIPE_WEBHOOK_SECRET_CONNECT=
STRIPE_WEBHOOK_SECRET_PLATFORM=
PLATFORM_FEE_BPS=300
PLATFORM_FEE_FIXED_CENTS=0
RESERVATION_MINUTES=30
EMAIL_PROVIDER=mailpit        # mailpit | resend
RESEND_API_KEY=
EMAIL_FROM=
SMTP_HOST=localhost           # Mailpit
SMTP_PORT=1026
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
SENTRY_DSN=
```
