# Testing

How LawCRM tests its work, what contributors (human and agent) are expected to write, and what runs automatically. If a code path disagrees with what's here, the doc is right: fix the code.

## TL;DR

- **Framework:** Vitest. `npm test` (full suite), `npm run test:watch` (TDD), `npm run test:ui`.
- **Tests live alongside source**: `src/lib/sol.ts` -> `src/lib/sol.test.ts`; no `__tests__/` folder.
- **Every new feature ships with at least one test.** The pre-commit hook (`.husky/pre-commit`) runs typecheck, lint and the tests related to staged files; failures block. CI runs the full suite.
- **The suite needs the Docker test database** (`docker compose -f docker-compose.test.yml up -d`): every `vitest` run, even a pure-unit one, goes through the DB `globalSetup`.

---

## Discipline

When you add or change behavior, add or update a test. The bar isn't 100% coverage; it's "this is exercised by code that runs before the diff lands."

| Change | Test posture |
|---|---|
| New pure helper in `src/lib/` | Direct unit test for every public export. Required, no exceptions. |
| New permission key | Add to the expected-key list in `src/lib/permissions.test.ts`. Required. |
| New server action | Integration test (DB + action) or a focused unit test of the validation/branching. Required for non-trivial logic. |
| New schema field that drives logic | Test exercises the field via the helper that reads it. Required. |
| New UI component | Component test if it has non-trivial state. Layout-only is exempt. |
| Bug fix | Reproducer that fails before the fix, passes after. Required. |
| Pure cosmetic / docs change | None. |

If you skip a test on a non-cosmetic change, say why in one line in the commit message ("untestable without real Gmail OAuth"). Don't silently skip.

### What runs on commit and in CI

`.husky/pre-commit` (header comment documents it):

1. `npm run precommit` = `npm run typecheck` (`next typegen && tsc --noEmit`) + `npm run lint` (ESLint, `--max-warnings 0`).
2. `npm run test:related -- <staged src .ts/.tsx files>` (`vitest related --run`): only test files whose import graph reaches a staged file. Skipped when no `src/` TypeScript is staged.
3. Only when `prisma/schema.prisma` or `prisma/migrations/` is staged: `npm run check:migrations` (applies every migration to a scratch DB and diffs against `schema.prisma`, ADR-016).

The hook deliberately does NOT run the whole suite. Related-test selection follows static imports, so it can miss a test reaching your change through a dynamic import, a config/schema file, or shared DB state: **run `npm test` before pushing.** Fast loops: `npm run test:related -- <files>`, `npm run test:watch`, `npx vitest run path/to/file.test.ts`.

**CI** (`.github/workflows/test.yml`, push and PR to `main`) is the full-suite gate: Postgres 17 service, Node 24, typecheck, lint, then `npm test` in a matrix of `TZ=America/Denver` and `TZ=UTC` (each TZ split into shards), `TEST_DATABASE_URL` at the service. No secrets (tests are hermetic) and no docker CLI (`integration-setup.ts` talks to Postgres through `pg`). The Prisma agent-consent variable is needed only when an AI agent drives Prisma locally.

**Bypass** (`git commit --no-verify`) is for work-in-progress branches you'll clean up before merging. Never for `main`.

The test DB's schema-push step refuses to run without consent text in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` when an AI agent drives Prisma (the container is local and disposable, but Prisma can't tell); agent sessions export it for the hook.

---

## Layers

### Layer 1: unit tests for pure helpers

Files in `src/lib/**` that don't touch the DB, filesystem or network. Fast, no setup, every public export tested. Write a sibling `*.test.ts` for every new pure-function file.

### Layer 2: component / hook tests

Client components with non-trivial state (forms, dialogs, the matrix UI, optimistic toggles). `happy-dom` + `@testing-library/react` + `@testing-library/user-event`; `src/test/setup.ts` wires jest-dom matchers and `cleanup()` after each test (loaded only when a DOM exists). `vitest.config.ts` has two projects: `dom` (happy-dom, `*.test.tsx`) and `node` (`*.test.ts`); a `.ts` test needing DOM APIs opts in with `// @vitest-environment happy-dom`. Examples: `PermissionsMatrix`, `ExpenseComposer`, `SettlementApprovals`, `ConflictCheckCard` (`ls src/components/**/*.test.tsx`).

- Async server components are tested by awaiting the component function and rendering its result.
- Billing/capture/note component tests that mock `@/lib/permission-check` must also mock `requirePermissions` (delegating per key to the `requirePermission` mock) because capture and note actions call it.
- **Mocking pattern:** stub the server action at module level (`vi.mock("@/app/actions/foo", () => ({ ... }))`) and set `mockedAction.mockResolvedValue(...)` per case. Don't exercise the action's real validation here; that's layer 1 / 3.
- **Querying inputs:** form helpers often don't associate `<label>` via `htmlFor`, so `getByLabelText` may fail. Prefer `container.querySelector('[name="foo"]')`, `getByRole("button", { name: /foo/i })`, `getByPlaceholderText(...)`.
- **happy-dom traps** (document any new one in-file): `window.alert` / `confirm` don't exist, so use `vi.stubGlobal`, not `vi.spyOn`. Base UI render-prop anchors expose no accessible name to `getByRole`: query by text + `closest("a")`. A `next/link` mock must compose the caller's `onClick` before `preventDefault`. The `Button` wrapper infers `nativeButton: false` when a `render` element is supplied (tested; avoids a console warning when it renders a `<Link>`).

### Layer 3: server action / Prisma integration tests

Real DB, real Prisma, real action. Slower (50-500ms/test); use for the highest-leverage workflows.

**Infrastructure:**

- A **dedicated dockerized Postgres** (tmpfs, port 5433). The container outlives runs (restart it to wipe state); your dev `DATABASE_URL` is never touched.
- `TEST_DATABASE_URL` overrides the target (default `.../lawcrm_test` on :5433). The name must start with `lawcrm_test` and the host must be local: `src/test/test-db-guard.ts` refuses anything else in both `globalSetup` and `resetDb()`, because setup force-pushes the schema and every test deletes all rows. Never open a connection to the base `lawcrm_test` database from a test; use `DATABASE_URL`.
- `src/test/integration-setup.ts` (Vitest `globalSetup`, once, idempotent per process): points `DATABASE_URL`/`DIRECT_DATABASE_URL` at the container, sets `DATABASE_POOL_MAX=4` (so lock-contention tests really overlap), waits up to 30s for the DB, takes a per-database advisory **run lock**, pushes the schema (`prisma db push --accept-data-loss`) into the base DB, then clones it into per-worker DBs.
- **Per-worker databases.** The base DB is only a template; `globalSetup` drops/recreates `<base>_w1 .. <base>_wN` via `CREATE DATABASE ... TEMPLATE <base>` (N = `maxWorkers`: half the cores capped at 4; `TEST_MAX_WORKERS` overrides; `src/test/test-db-config.ts`). `src/test/worker-db-setup.ts` (first in `setupFiles`) points each worker's `DATABASE_URL` at `<base>_w<VITEST_POOL_ID>` before `@/lib/prisma` loads. Files run in parallel without sharing rows (`fileParallelism: true`); tests within a file run sequentially via `beforeEach { resetDb() }`, which wipes only the worker's DB. `TEMPLATE` needs zero connections on the base DB, so the run lock is held on the `postgres` maintenance DB keyed by `(RUN_LOCK_KEY, hashtext(base name))`. `_wN` DBs persist between runs. Concurrency tests (`billing.concurrency.test.ts`, advisory-lock, parallel-login) stay correct since each file has a private DB.
- **Run lock.** A second one-shot `vitest` run against the SAME database (commit hook plus manual `npm test`, two agent sessions) queues behind the first and fails after `TEST_DB_LOCK_TIMEOUT_MS` (default 10 min). Watch/`--ui` sessions don't hold it.
- `src/test/setup.ts` makes tests hermetic: deletes `BLOB_READ_WRITE_TOKEN`, `STORAGE_DRIVER`, `CRON_SECRET`, Google and `AUTH_URL` variables, sets a deterministic `EMAIL_TOKEN_KEY`, and blocks `fetch` to any non-loopback host (mock fetch in the test).
- `src/test/integration-helpers.ts`: `resetDb()` is a single `DO $$ ... DELETE ... $$` statement over an explicit table list (**new tables must be added to it**, in FK-safe order); fixture builders (`seedFirm`, `seedUser`, `seedPracticeArea`, `seedMatter`, `seedTimeEntry`, `seedExpense`, `seedContact`, `seedMatterContact`, `seedLead`, `seedCalendarEvent`, ...) return the row id.
- `syncEmailAccount` takes a `fullSyncMaxThreads` test seam.

**Mocking pattern** for action tests:

```ts
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// Mock the permission gate when the test is about action logic, not
// authorization (requirePermission is covered in
// permission-check.integration.test.ts).
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
// redirect throws an internal error in prod; stub it to something assertable.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`__REDIRECT__:${url}`); }),
}));
```

**Patterns worth copying** (read the files for the rest): `src/app/actions/billing*.test.ts`; `billing.concurrency.test.ts` mocks `@/lib/prisma` with a multi-connection pool (`max > 1`) and waits on `pg_stat_activity` to prove real lock contention; time-entry writes are conditional single-statement updates (they race with invoice generation), tested with a `vi.spyOn(prisma.x, "findUnique")` stale-read pattern; `src/lib/permission-check.integration.test.ts` for the resolver; `src/lib/google/gmail-sync.test.ts` mocks `gmailFetch` as a URL-dispatching fake Google with a real DB; `activity-log.test.ts` pins the fire-and-forget contract (DB failures swallowed with `console.warn` so the user's action stays the source of truth).

### Static guard tests

- **`src/app/page-guards.test.ts`** scans every `page.tsx` and `layout.tsx` under `src/app/(dashboard)` and `src/app/print` and fails unless the default export's FIRST `await` is a session guard (`requireUser`, `requirePermission`, `requireAdmin` or `getCurrentUserId`) with no `prisma.` access before it (ADR-028). `PAGE_ALLOWLIST` (keep it empty) and `LAYOUT_ALLOWLIST` (dashboard and print layouts) are the only exemptions; any new entry needs a justifying comment.
- `src/lib/permissions.test.ts` scans production sources and fails if a literal key passed to `requirePermission`, `requirePermissionResult` or `currentUserHasPermission` is not in the catalog.
- `src/vercel-config.test.ts` pins the proxy's self-authenticated paths (cron endpoints, blob callback).
- The Google calendar pull module must never import `google-calendar-push` or the calendar-events actions (echo safety); an import-statement scan in `google-calendar-sync.test.ts` pins it.

---

## File conventions

- One test file per source file, sibling-located (`foo.ts` -> `foo.test.ts`).
- Use `describe` / `test` (not `it`; the suite uses `test`). Group related assertions under a `describe`; one assertion per test where practical (readable failures over clever DRY).
- Use `toMatch(/regex/)` over `toBe("exact string")` for any output through `Intl` (date/number formatting varies across Node versions).
- Pin time with `vi.useFakeTimers()` + `vi.setSystemTime(...)` for anything depending on "now".
- Cover empty / null / negative / zero edges explicitly; the bug is almost never in the happy path.

## What NOT to test

- Implementation details outside the public surface (test the export, not the closure).
- Layout / pixel-perfect rendering; snapshot tests of visual output rot and add little signal.
- Third-party network calls in unit tests: mock the adapter layer or use a dedicated, less frequent integration suite.
- What the type system already catches (`expect(x).toBeDefined()` on a non-optional `string`).

---

## Running tests

| Command | What |
|---|---|
| `npm test` | Full suite, exit 1 on failure. Needs the Docker test DB. |
| `npm run test:watch` | Watch mode (TDD default). |
| `npm run test:related -- <files>` | Only tests importing the given files (what the hook runs). |
| `npm run test:ui` | Vitest UI at `http://localhost:51204/__vitest__/`. |
| `npm run test:utc` | Full suite with `TZ=UTC`, the production server's zone. |
| `npm run test:coverage` | `vitest run --coverage`; the only place coverage thresholds apply. |
| `npm run typecheck` / `npm run lint` | `next typegen && tsc --noEmit` / ESLint `--max-warnings 0`. |
| `npm run check:migrations` | Migrations vs `schema.prisma` drift check. |
| `npm run precommit` | `typecheck` + `lint` (the hook adds related tests and the migration check). |

The hook is wired via `npm run prepare` (auto-runs after `npm install`).

**Run `test:utc` before shipping anything that touches dates (ADR-012).** Production runs in UTC while developers and their browsers sit west of it; a bug mixing the two frames passes in one zone and fails in the other, so date work must be green in both.

**Parallel suites.** Files inside ONE run are already parallel (per-worker DBs); this is about two separate runs. Each base DB is single-tenant behind a run lock; a second run against the same DB waits. To run a second suite at the same time, give it its own DB in the same container (`docker exec lawcrm-test-postgres createdb -U lawcrm_test lawcrm_test_2`, then `TEST_DATABASE_URL=postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test_2`).

## Coverage

`npm run test:coverage` (v8) is scoped to `src/lib/**` and `src/app/actions/**`; the rest is UI/wiring better measured by component + integration tests. **The floor lives in the `coverage.thresholds` block of `vitest.config.ts`, not here** (a snapshot here drifted; don't reintroduce one). Thresholds apply only under `--coverage`.

Target: every public function in `src/lib/` has a test. **Raising the floor:** when new tests move the numbers materially, raise `coverage.thresholds` in the same change, leaving a few points of headroom so refactors don't trip it. **Lowering the floor is not allowed**; fix the tests first.

---

## Adding a test for a new feature

1. Open the sibling `*.test.ts` of the file you're changing (create it if missing); add a `describe` for the new behavior.
2. Add at least one positive and one negative case (null / wrong type / out-of-range / unauthorized).
3. Iterate with `npm run test:watch` or `npx vitest related <file> --run`; also `npm run test:utc` if the code touches dates.
4. Commit; the hook re-runs typecheck, lint and the related tests. Run `npm test` before pushing.

For features spanning several files (server action + client form), unit-test the pure helpers and write one representative integration test for the end-to-end flow.
