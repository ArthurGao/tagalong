# RUNBOOK — staging and production

How TagAlong runs outside a laptop (DESIGN §13): what lives where, how a release goes out, how to check it, and how
to restore the database. Secrets live only in each provider's dashboard and never in this repo.

## 1. Where things run

| | staging | production |
|---|---|---|
| Web (Vercel, one project, root `frontend`) | `staging.tagalong.nz`, `admin-staging.tagalong.nz` | `tagalong.nz`, `admin.tagalong.nz` |
| API (Render, Singapore, `render.yaml`) | `tagalong-api-staging` → `api-staging.tagalong.nz` | `tagalong-api` → `api.tagalong.nz` |
| Postgres (Neon, aws-ap-southeast-1) | project `tagalong-staging` | project `tagalong-prod`, history retention ≥ 7 days |
| Clerk | a second Development instance | Production instance on `tagalong.nz` |
| Stripe | test mode, fixed webhooks | live mode |
| Email (Resend) | `staging.tagalong.nz` sender | `tagalong.nz` sender |
| Images (Cloudflare R2) | bucket `tagalong-staging` | bucket `tagalong-prod`, versioning on |
| Turnstile | its own widget | its own widget |
| Sentry | one project per app, environment `staging` | the same projects, environment `production` |

The API and its database sit in the same region: a transaction such as order creation makes about ten round trips
under row locks, so a cross-region database (about 90 ms each) would hold stock locks for about a second.

## 2. Environment variables

**API (Render).** Plain values come from `render.yaml`; every secret is `sync: false` and entered in the dashboard.
The full list and meanings are in `backend/CLAUDE.md` (Env) and `backend/.env.example`.
- Set by the blueprint: `APP_ENV`, `APP_URL`, `CLERK_AUTHORIZED_PARTIES`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM` and
  `TRUST_PROXY`. `NODE_ENV=production` comes from the Dockerfile; `PORT` and `RENDER_GIT_COMMIT` are set by Render.
- Secrets:
  - `DATABASE_URL` (Neon, pooled), `ADMIN_EMAIL_ALLOWLIST`;
  - `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` (PEM), `CLERK_WEBHOOK_SIGNING_SECRET`;
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `STRIPE_WEBHOOK_SECRET_PLATFORM`;
  - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`;
  - `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `SENTRY_DSN`.
- The API refuses to start with any of these missing, with a test key in production, or with a live key anywhere else
  (`src/config/env.ts`).
- **Buyer IP (rate limits, audit):** `TRUST_PROXY=1` trusts Render's load balancer only. Requests through the web
  app carry the buyer's IP in `x-tagalong-client-ip` with `EDGE_SECRET`; the same value must be set on Render and
  Vercel, for example from `openssl rand -hex 32`. A direct caller, webhooks included, cannot forge an IP, because
  without the secret the header is dropped.
  - Check on staging: 11 order requests in a minute through the site get 429 from the 11th; two different networks
    keep separate limits.

**Web (Vercel)**, per environment: `BACKEND_URL` (the API base), `EDGE_SECRET` (same value as the API's), `NEXT_PUBLIC_APP_URL`, `ADMIN_HOST` (the admin host
name), `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `NEXT_PUBLIC_SENTRY_DSN`. The build also gets `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG` and `SENTRY_PROJECT` for source maps. Full list: `frontend/.env.example`.

## 3. Releasing

1. Merge to `main`. CI (lint, typecheck, unit, e2e, build) must pass.
2. **Staging deploys itself:**
   - Render deploys `tagalong-api-staging` once checks pass. Its pre-deploy step (`pnpm prisma:deploy`) applies new
     migrations before the new version takes traffic; a failed migration stops the deploy, and the old version keeps
     serving.
   - Vercel deploys the staging web.
3. Run `scripts/smoke.sh staging https://api-staging.tagalong.nz https://staging.tagalong.nz https://admin-staging.tagalong.nz`.
4. **Production, by hand:**
   - Render → `tagalong-api` → Manual Deploy of the same commit. Migrations run first, as on staging.
   - Then promote the Vercel deployment.
   - Then run `scripts/smoke.sh production https://api.tagalong.nz https://tagalong.nz https://admin.tagalong.nz`.
   - `/api/v1/health` must report `env` and the expected `release` commit.
5. **Migrations are forward only:**
   - Never edit an applied one.
   - A change that would break the running old version (dropping or renaming a column it reads) ships in two releases:
     first stop using it, then remove it.

## 4. One-time setup per environment

**Neon.** Create the project in aws-ap-southeast-1. For production, set the history retention to at least 7 days
(a paid plan). Use the pooled connection string for `DATABASE_URL`.

**Stripe** (test mode on staging, live on production). In Developers → Webhooks, add two endpoints:
- `https://api…/api/v1/webhooks/stripe/connect`, **listening to events on Connected accounts** (direct charges happen
  there):
  - `account.updated`
  - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
    `checkout.session.async_payment_failed`
  - `charge.refunded`
  - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

  Its signing secret goes into `STRIPE_WEBHOOK_SECRET_CONNECT`.
- `https://api…/api/v1/webhooks/stripe/platform`, **events on your account**, with the same list. Its secret goes into
  `STRIPE_WEBHOOK_SECRET_PLATFORM`. Platform events are unexpected while all charges are direct; the endpoint makes
  sure they are verified and recorded, not lost.
- Check on staging that a test event reaches the endpoint with a 200 (`stripe trigger checkout.session.completed
  --stripe-account acct_…`). The `stripe_event` table must show the row with `processed_at` set.
- Turn on Connect (Standard accounts) for the platform. Production may receive no real payment until DESIGN §16-6 is
  done (Clerk Pro with MFA for admins).

**Clerk.**
- Staging uses a second Development instance. Production uses a Production instance on `tagalong.nz`: add its DNS
  records (Frontend API and email CNAMEs) and wait for verification.
- Webhook: `https://api…/api/v1/webhooks/clerk` for `user.created`, `user.updated`, `user.deleted` and
  `session.created`. Its Svix secret goes into `CLERK_WEBHOOK_SIGNING_SECRET`.
- `CLERK_JWT_KEY` is the instance's PEM public key (API keys → Advanced).
- Allow the admin host as a satellite or authorized party.
- **Check the admin-subdomain session** (DESIGN §16-8): sign in on `admin…` and open the console. If the session does
  not hold, move admin to `/admin` on the main host (DESIGN §13 fallback) before going on.
- Grant the first admin with `pnpm admin:grant <email>`, run from a machine with the environment's `.env`; the email
  must be in `ADMIN_EMAIL_ALLOWLIST`.

**Resend.** Add the sending domain and its DNS records (SPF, DKIM, return path), and create an API key for that
domain only.

**Cloudflare.**
- R2: one bucket per environment, with a custom domain or a public URL for `S3_PUBLIC_BASE_URL`.
  - Production: versioning on.
  - CORS: allow PUT from the web host (uploads are presigned PUTs).
  - The API token covers that bucket only.
- Turnstile: one widget per environment, for the web host names.

**Sentry.** Two projects (api, web). The DSNs go into `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`; an org auth token
with `project:releases` goes into Vercel's `SENTRY_AUTH_TOKEN`. After the first deploy:
- throw a test error on staging;
- check that the event arrives without cookies, bodies, order tokens or the user.

## 5. Restore drill (DESIGN §13: weekly; at least once before launch)

1. Pick a restore point T, for example 30 minutes ago, and note it.
2. Create a branch at T without touching production:
   `neonctl branches create --project-id <prod-project> --name restore-drill-<date> --parent production --timestamp <T as ISO 8601>`.
3. Run the check against the branch and against production with the same T, and diff the outputs:
   `psql "<branch URL>" -v t="'<T>'" -f scripts/restore-check.sql > branch.txt`, the same against production into
   `prod.txt`, then `diff branch.txt prod.txt`. They must be identical. The script compares only what cannot change
   after T: rows created up to T, by count and by a checksum over columns written once (ids, codes, amounts charged,
   the append-only audit log). Refunds or status changes after T do not count as differences.
4. Optionally point a local API at the branch (`DATABASE_URL=… pnpm dev`) and open an order created before T.
5. Delete the branch: `neonctl branches delete restore-drill-<date> --project-id <prod-project>`.
6. Add a line to the log below.

**Other backups.**
- R2 versioning (production) keeps overwritten or deleted images.
- Clerk: export users monthly (Dashboard → Users → Export), stored outside Clerk, encrypted.

| Date | Environment | Restore point | Result | By |
|---|---|---|---|---|

## 6. When something is wrong

- **API errors:** Sentry (api project), and the Render logs. pino lines carry `req.id`, which matches the
  `x-request-id` response header.
- **Emails not arriving:**
  - `notification_outbox` rows with `status = 'FAILED'` (also reported to Sentry, ids only).
  - A provider outage leaves rows PENDING with growing `attempts`; they retry on 1, 5, 30 min, 2 h, 12 h.
- **Refunds stuck:**
  - `refund_task` rows that stay PENDING past their `next_attempt_at`.
  - FAILED refunds of a cancellation are retried from the admin console (bulk refunds page); single refunds by the
    merchant.
- **Rollback:**
  - Redeploy the previous commit in Render and Vercel.
  - Migrations do not roll back. That is why changes ship in two releases (step 3.5): the previous version keeps
    working on the new schema.
