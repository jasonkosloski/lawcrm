# Kosloski Law CRM

A practice-management CRM for a civil-rights law firm: matters, intake,
contacts, calendaring, deadlines (incl. statute-of-limitations tracking),
time & expenses, billing with trust accounting, settlements, notes, tasks,
documents, and a unified email + SMS/call communication inbox.

Built with Next.js 16 (App Router), Prisma 7 + PostgreSQL, shadcn/ui,
Tailwind v4, and Clerk (Google sign-in for staff). Mutations are permission-gated server actions
with an audit trail. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
for the full picture and [`docs/README.md`](./docs/README.md) for the
documentation index.

## Getting started

```bash
npm install                      # also wires the husky pre-commit hook
cp .env.example .env             # then fill in DATABASE_URL etc. (below)
npx prisma migrate deploy        # apply migrations to your dev Postgres
npm run db:seed                  # demo firm + users (dev DB only!)
npm run dev                      # http://localhost:3000
```

**Seed guard:** `npm run db:seed` and `npm run db:reset` wipe data, so
they refuse to run unless every configured database host is localhost /
127.0.0.1 / ::1. `prisma.config.ts` applies the same guard to
`prisma migrate reset` and `prisma db seed` (including `--force-reset`),
not just the seed script. To seed the hosted `lawcrm-dev` database
(below) you must opt in explicitly: `ALLOW_SEED=1 npm run db:seed`.
Production-looking environments (`NODE_ENV` / `VERCEL_ENV` =
production) are always refused, even with `ALLOW_SEED=1`. The seed sets
every demo user's password from `SEED_ADMIN_PASSWORD`; if unset it
generates a random one and prints it once at the end of the run.
`SEED_NOW=YYYY-MM-DD` pins the date the demo data is anchored to
(default: today in America/Denver), so figures change with the day
unless you pin it.

**Dev database:** a dedicated Prisma Postgres, `lawcrm-dev`, attached
to the Vercel project's Development environment as
`DEVDB_DATABASE_URL`. Put that value in `.env` as both
`DATABASE_URL` and `DIRECT_DATABASE_URL`. **Never point local dev at
the production database** (`DATABASE_URL` in Vercel) — the seed
overwrites data and resets every user's password. Watch out for
`vercel env pull` / `vercel link`: they write Development variables
into `.env.local`, which Next.js loads *over* `.env`. Schema changes ship as migrations
(`npx prisma migrate dev --name <change>`) — see ADR-016 in
`docs/decisions/`. Staff sign in with Google via Clerk and there is no self sign-up: admins invite
people from Settings -> Team, and the first sign-in links the Clerk identity to
the pre-created user by verified email. Locally, seed the demo users, set
`DEV_SIGN_IN=1` in `.env.local` and use `/dev/sign-in-as` (see
`docs/features/auth.md`). It is off unless you opt in, and refuses a
non-local database (unless `ALLOW_SEED=1`): with it on, anyone who can reach
your dev server can sign in as any active user.

## Environment

Copy `.env.example` and read the comments there; it is the reference.
Notable variables:

- `DATABASE_URL` / `DIRECT_DATABASE_URL` - Postgres. `DATABASE_POOL_MAX`
  is optional.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - staff sign-in
  (Clerk). Set `STAFF_ORIGINS` to the staff origin and
  `CLERK_WEBHOOK_SIGNING_SECRET` for the audit webhook in production; see
  [`docs/features/auth.md`](./docs/features/auth.md).
- `AUTH_SECRET` - required in every environment. No longer used for staff
  sessions; keys the portal link-request HMAC and the Google integration's
  OAuth state. `AUTH_URL` is optional (only behind a proxy/CDN).
- `CRON_SECRET` - **required in production.** Vercel Cron sends it as a
  bearer token to `/api/email-sync` and `/api/notification-sweep`;
  unset means both return 401 and background syncs silently stop.
- `EMAIL_TOKEN_KEY` - encrypts stored Google OAuth tokens; required
  before connecting a Gmail account.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Gmail + Google Calendar
  integration. The Google Cloud project needs **both the Gmail API and
  the Google Calendar API** enabled (calendar sync fails with
  `accessNotConfigured` otherwise).
- `BLOB_READ_WRITE_TOKEN` / `STORAGE_DRIVER` - document storage
  (local disk in dev, private Vercel Blob in production).
- `SEED_ADMIN_PASSWORD`, `SEED_NOW`, `ALLOW_SEED` - seed only (above).
- `TEST_DATABASE_URL` - tests only (below).

## Tests

```bash
docker compose -f docker-compose.test.yml up -d   # test Postgres on :5433 (once)
npm test                                          # full suite
npm run test:utc                                  # same suite with TZ=UTC
npm run test:watch                                # while developing
```

Integration tests run against the Docker test database
(`localhost:5433/lawcrm_test`), never your dev DB. To run two suites at
once (worktrees, parallel sessions) give each its own database in the
container and set `TEST_DATABASE_URL` (must be a local database named
`lawcrm_test*`). Run `npm run test:utc` too when you touch date logic.

The pre-commit hook runs `typecheck + lint + test` on every commit
(plus a migration-drift check when the schema or migrations are
staged). Testing discipline lives in [`docs/TESTING.md`](./docs/TESTING.md).

## Working on this repo

Read [`AGENTS.md`](./AGENTS.md) first — it's the contract for humans and
AI agents alike: every feature ships with a test, every gated capability
gets a granular permission key, mutations are server actions, and docs
are updated as part of the change that makes them stale.
