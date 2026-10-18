# ADR-016: Postgres migration baseline — `prisma migrate` replaces `db push` for schema changes

**Date:** 2026-10-16
**Status:** Accepted

**Context:** `prisma/migrations/` held 30 migrations generated while the app ran on SQLite (`migration_lock.toml` said `provider = "sqlite"`; the SQL used `PRAGMA` / `DATETIME` / table-rebuild idioms). They could never run against Postgres, so after the Postgres switch every database — dev, test, and production — was shaped by `prisma db push`, and nothing recorded the schema changes made after 2026-04-28 (document folders, calendar sync, saved searches, timers, notifications, firm goals, …).

**Decision:**
- The SQLite migrations are retired (still in git history) and replaced by a single Postgres baseline, `prisma/migrations/0_init`, generated with `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. Verified by applying it to an empty Postgres and diffing back against the schema: no difference.
- From here on, schema changes ship as migrations (`prisma migrate dev --name <change>`), committed with the change and listed in `SCHEMA_NOTES.md`.
- **Existing databases are baselined, not re-created.** For a database that was built by `db push` (including production), first confirm it matches the schema, then mark the baseline as applied:
  1. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → must report "No difference detected." (If it doesn't, reconcile with `db push` against that DB first, reviewing the diff.)
  2. `prisma migrate resolve --applied 0_init`
  3. Later migrations then apply with `prisma migrate deploy`.
- The test harness keeps using `db push --accept-data-loss` against the throwaway tmpfs container — speed over history is right there.
- **Drift is enforced.** `npm run check:migrations` (`scripts/check-migrations.mjs`) fails when the migration history does not reproduce `schema.prisma`; the pre-commit hook runs it whenever `prisma/` is staged. A schema edit without its migration cannot be committed.
- **`npm run db:reset` is guarded.** `prisma.config.ts` runs the seed guard (`src/lib/seed-guard.ts`) before `migrate reset`, `db seed` and `--force-reset`: localhost / 127.0.0.1 / ::1 only, `ALLOW_SEED=1` required for the hosted dev database, refused under a production environment. A mistyped `DATABASE_URL` can no longer wipe a hosted database before the seed's own guard runs.

**Trade-offs:**
- (+) Schema history is real again; production changes become reviewable, repeatable SQL instead of whatever `db push` decides on the day
- (+) Fresh environments come up with `prisma migrate deploy` instead of a drift-prone push
- (-) One-time manual baseline step per existing database (above)
- (-) The build does not run `migrate deploy` yet — preview deployments share env vars with production on many setups, and an automatic migration from a preview build is how a prod DB gets changed by an unmerged branch. Wiring it into the deploy pipeline is a separate decision.
