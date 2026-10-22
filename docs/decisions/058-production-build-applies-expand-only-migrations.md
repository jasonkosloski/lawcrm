# ADR-058: The production build applies pending migrations; destructive ones need an explicit marker

**Date:** 2026-10-20
**Status:** Accepted. Supersedes ADR-016's "the build does not run `migrate deploy`" trade-off.

**Context:** Code reached production on every push to main, but migrations reached it only when the user ran `prisma migrate deploy` by hand. With several sessions pushing main, code nearly always landed first: on 2026-10-20 the venues and matter-drafts migrations went out unapplied and `/matters/new` and every matter Overview failed with P2021/P2022. The manual step also kept failing on its own: the shell's exported URLs override `.env`, `prisma.config.ts` prefers a `DIRECT_DATABASE_URL` that points at dev, and a placeholder URL sat exported in the shell. ADR-016 deferred automation because preview builds might share production's database URL; on Vercel, `DATABASE_URL` has separate Production and Preview/Development values.

**Decision:**

- `vercel.json` sets `buildCommand` to `npm run vercel-build` (`scripts/vercel-build.ts`). When `VERCEL=1` and `VERCEL_ENV=production` it runs `prisma migrate deploy` against the build's `DATABASE_URL` (with `DIRECT_DATABASE_URL` pinned to it), then `prisma generate && next build`. Every other build only builds; `npm run build` is unchanged.
- Migrations run before `next build`, so a failed migration fails the build and the previous deployment keeps serving. The build log prints the target host, never the URL.
- The previous deployment serves traffic while the build migrates, so auto-applied migrations must be expand-only. The build reads `_prisma_migrations`, and if a pending migration drops, renames or retypes anything, sets `NOT NULL`, drops a default, truncates or deletes (comments ignored; `src/lib/migration-deploy-guard.ts`), the build fails unless that migration folder holds an `ALLOW_DESTRUCTIVE` file stating why it is safe now. Add one only once the live code no longer uses what the migration removes (expand, deploy, then contract).
- The pre-commit hook runs the same check on staged `migration.sql` files, so the refusal shows up at commit time. The four destructive migrations already applied by hand carry markers so a fresh database can still be built.
- A migration committed to main ships with the next push; no separate "ask before pushing" step. Data backfills (`DEPLOY_BACKFILLS.md`) and failed-migration recovery (`prisma migrate resolve`) stay manual.

**Trade-offs:**

- (+) Schema and code go live together; no hand-run step to forget or point at the wrong database
- (+) A failed or refused migration blocks the deploy instead of breaking production
- (-) Production schema changes unattended, so recovery relies on the database provider's backups / point-in-time restore
- (-) The destructive-SQL check is pattern-based: it can miss a destructive `UPDATE` or a data-dependent constraint, and it flags safe statements (the marker overrides)
- (-) A failed migration leaves `_prisma_migrations` marked failed; every production build fails (P3009) until someone resolves it by hand
