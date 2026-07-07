# Kosloski Law CRM

A practice-management CRM for a civil-rights law firm: matters, intake,
contacts, calendaring, deadlines (incl. statute-of-limitations tracking),
time & expenses, billing with trust accounting, settlements, notes, tasks,
documents, and a unified email + SMS/call communication inbox.

Built with Next.js 16 (App Router), Prisma 7 + PostgreSQL, shadcn/ui,
Tailwind v4, and Auth.js v5. Mutations are permission-gated server actions
with an audit trail. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
for the full picture and [`docs/README.md`](./docs/README.md) for the
documentation index.

## Getting started

```bash
npm install                      # also wires the husky pre-commit hook
cp .env.example .env             # then fill in DATABASE_URL etc.
npx prisma db push               # sync schema to your dev Postgres
npm run dev                      # http://localhost:3000
```

Local dev needs a Postgres (hosted Prisma Postgres or your own — see
`.env.example`). Auth is email + password; create a user via the seed
or sign-up flow, then log in at `/login`.

## Tests

```bash
docker compose -f docker-compose.test.yml up -d   # test Postgres (once)
npm test                                          # full suite
npm run test:watch                                # while developing
```

The pre-commit hook runs `typecheck + test` on every commit. Testing
discipline lives in [`docs/TESTING.md`](./docs/TESTING.md).

## Working on this repo

Read [`AGENTS.md`](./AGENTS.md) first — it's the contract for humans and
AI agents alike: every feature ships with a test, every gated capability
gets a granular permission key, mutations are server actions, and docs
are updated as part of the change that makes them stale.
