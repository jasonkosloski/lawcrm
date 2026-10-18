# ADR-032: Database pool sizing

**Date:** 2026-10-17
**Status:** Accepted

**Context:** The pool was capped at one connection per process. With the advisory-lock transactions of ADRs 020, 030 and 031, a single slow transaction queued every other request in that instance, and the concurrency tests could not exercise real lock contention.

**Decision:** `src/lib/prisma.ts` sizes the `pg` pool from `DATABASE_POOL_MAX` (a positive integer), default **5** per instance. Vercel Fluid compute shares one instance across concurrent requests, so a handful of connections per instance is the right unit; total connections are instances times this value, which must stay under the database's limit (use a pooler for large fan-out). The test suite runs with `DATABASE_POOL_MAX=4`, and lock-contention tests use a multi-connection pool on purpose.

**Trade-offs:**
- (+) Concurrent requests no longer serialize behind one connection; row- and advisory-lock behavior is testable
- (-) More connections per instance; revisit if the database connection limit is approached
