# CLAUDE.md — TagAlong (root)

TagAlong is a New Zealand group-buy / 接龙 platform. Any merchant can self-register, publish a listing (retail goods, lessons, or events), share a public link, and buyers pay via Stripe without creating an account.

**Read `docs/DESIGN.md` before starting any feature.** It is the single source of truth for scope, the data model, the order state machine, the Stripe flow and the API. If an implementation needs to deviate from it, update DESIGN.md in the same change and explain why.

## Repo layout

```
/
├── CLAUDE.md            ← this file (global rules)
├── docs/DESIGN.md       ← product + technical design
├── docs/UI-STYLE.md     ← visual style per surface (public / merchant / admin)
├── backend/             ← NestJS + Prisma + PostgreSQL (see backend/CLAUDE.md)
├── frontend/            ← Next.js App Router + Tailwind + shadcn/ui (see frontend/CLAUDE.md)
├── docker-compose.yml   ← postgres, mailpit (local dev)
├── pnpm-workspace.yaml
└── .github/workflows/   ← CI: lint, typecheck, test, build
```

This is a pnpm workspace with two packages, `backend` and `frontend`. There is no shared types package: the frontend's types are generated from the backend's OpenAPI spec.

## Commands (root)

```bash
pnpm install
docker compose up -d                  # postgres :5442, mailpit UI :8026 (SMTP :1026)
pnpm --filter backend prisma:migrate  # apply migrations
pnpm dev                              # runs backend (:3810) and frontend (:3800) in parallel
pnpm lint && pnpm typecheck && pnpm test
pnpm gen:api                          # backend writes openapi.json → frontend regenerates src/lib/api/schema.d.ts
stripe listen --forward-to localhost:3810/api/v1/webhooks/stripe/connect --forward-connect-to localhost:3810/api/v1/webhooks/stripe/connect
```

Keep these scripts working. If you add or change one, update this section.

## Tech choices

- Use Node LTS and TypeScript `strict` everywhere. Do not use `any` unless there is a comment explaining why.
- Use the latest stable versions at scaffold time, and pin them in package.json.
  - Exception: TypeScript is pinned to **6.0.x**, not 7. TS 7 (the native Go compiler) has no stable JS API yet, and typescript-eslint and the Nest CLI depend on it (typescript-eslint peer range `<6.1.0`). Revisit when they support 7.
  - Prisma: use the latest **stable** 7.x; npm's `latest` tag points at an 8.0 release candidate.
- Backend: NestJS, Prisma, PostgreSQL, class-validator, @nestjs/swagger, @nestjs/schedule, pino, the Stripe Node SDK, `@clerk/backend` and svix.
- Auth:
  - Merchants and admins share one **Clerk** application (Hobby tier) and are distinguished by role.
  - The role lives in our DB and is mirrored to Clerk `publicMetadata`.
  - The backend authorizes from the DB role (DESIGN D13, §9).
  - Buyers are guests and never sign in.
- Frontend: Next.js App Router, Tailwind, shadcn/ui, TanStack Query, react-hook-form + zod, next-intl (zh-CN, en), openapi-fetch.

## Non-negotiable domain rules

1. **Money is integer cents in NZD.** Never use floats for money. Prices are GST-inclusive.
2. **Store time in UTC.** Display it in `Pacific/Auckland`.
3. **Never trust client prices.** Line items and amounts are always computed server-side from the database.
4. **Never oversell.** Stock is reserved with a conditional atomic `UPDATE` (DESIGN §7). Never use read-then-write.
5. **Order status changes go only through `OrderStateMachine`** (DESIGN §6).
6. **Stripe webhooks must be idempotent.** Use the `StripeEvent` table, verify signatures with the raw body, and tolerate events arriving out of order.
7. **Use Stripe direct charges** on the merchant's connected account, with `application_fee_amount` (DESIGN D2).
8. **Never expose buyer PII publicly.** Public endpoints return only masked names (DESIGN §10).
9. **Never commit secrets.** Use `.env` (gitignored) and `.env.example`, which must list every variable. Only use Stripe test keys outside production.

## Working style for Claude Code

- Work milestone by milestone, following DESIGN §14. Finish one milestone (with its tests) before starting the next.
- Before writing code for a non-trivial task, briefly state your plan: which files you'll touch and the approach.
- Keep changes small and focused. Don't refactor code unrelated to the task.
- A task is done only when `pnpm lint`, `pnpm typecheck` and the relevant tests all pass. Run them yourself.
- When you change an API: update the controller DTOs and Swagger decorators, run `pnpm gen:api`, then fix the frontend type errors.
- When you change the database schema: create a new Prisma migration. Never edit a migration that has already been applied.
- If a requirement is ambiguous, check DESIGN.md first. If it's still unclear, ask instead of guessing on money, security or Stripe behaviour.
- Commit messages follow Conventional Commits (`feat(orders): reserve stock on checkout`).

## Language

Write code, identifiers, comments and commit messages in English. UI strings go through next-intl message files only, in both `zh-CN` and `en`. Never hardcode user-facing text.
