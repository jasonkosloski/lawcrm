# ADR-008: Prisma 7 SQLite driver adapter

**Date:** 2026-04-24
**Status:** Accepted

**Context:** Prisma 7 removed built-in query engines — every client must be constructed with an explicit driver adapter. The initial scaffold's `new PrismaClient()` (no options) would have crashed on first query at runtime.

**Decision:** Use `@prisma/adapter-better-sqlite3` for local dev. Construct the adapter with the `DATABASE_URL` from env and pass it to the client in both `src/lib/prisma.ts` (singleton used by Next.js) and `prisma/seed.ts` (seed script).

**Rationale:** `better-sqlite3` is synchronous, fast, and what Prisma recommends for dev. For production we'll swap to `@prisma/adapter-pg` with a Postgres connection string (see ADR-001).

**Trade-offs:**
- (+) Matches Prisma 7's required pattern — avoids a runtime crash that's easy to miss in dev
- (+) Adapter pattern makes prod swap mechanical
- (-) Adds two dependencies (`@prisma/adapter-better-sqlite3`, `better-sqlite3`) with native compile step
