# ADR-001: SQLite for development, PostgreSQL for production

**Date:** 2026-04-24
**Status:** Accepted

**Context:** We need a database that's zero-config for local development but production-grade when deployed.

**Decision:** Use SQLite via Prisma for local dev. Swap the `datasource` to PostgreSQL when deploying. Prisma abstracts the differences for most queries.

**Trade-offs:**

- (+) No Docker/postgres setup needed to start developing
- (+) DB file is portable, easy to reset (`rm dev.db && prisma migrate dev`)
- (-) Some Prisma features differ between SQLite and Postgres (e.g., `@db.Text`, full-text search, JSON querying)
- (-) Need to test against Postgres before production deployment

**Mitigation:** We'll switch to Postgres before building features that need full-text search or complex JSON queries. SQLite is fine for the CRUD-heavy early phases.
