# Testing

How LawCRM tests its work, what we expect contributors (human and
agent) to write, and what runs automatically. If a code path
disagrees with what's here, the doc is right — fix the code.

## TL;DR

- **Framework:** Vitest. `npm test` runs the suite, `npm run test:watch` for
  TDD, `npm run test:ui` for the dashboard.
- **Tests live alongside source.** `src/lib/sol.ts` →
  `src/lib/sol.test.ts`, no separate `__tests__` folder.
- **Every new feature ships with at least one test.** The
  pre-commit hook runs typecheck, lint and the tests related to the
  staged files on every commit; failures block. CI runs the full suite.
- **Tests run on every git commit.** Husky pre-commit hook in
  `.husky/pre-commit`.
- **The suite needs the Docker test database** (every `vitest` run,
  even a pure-unit one, goes through the DB `globalSetup`). The full
  suite runs files in parallel, one database per worker, and takes
  under two minutes on a laptop.

---

## Discipline

### Every feature gets a test

When you add or change behavior, you also add or update a test.
The bar isn't 100% coverage — the bar is "this thing is exercised
by code that runs in the pre-commit hook before the diff lands." Concretely:

| Change                                  | Test posture                                                             |
|-----------------------------------------|--------------------------------------------------------------------------|
| New pure helper in `src/lib/`           | Direct unit test for every public export. Required.                      |
| New permission key                      | Add to the expected-key list in `src/lib/permissions.test.ts`. Required.|
| New server action                       | Either an integration test (DB + action) or a focused unit test for the validation/branching logic. Required for non-trivial logic. |
| New schema field that drives logic      | Test exercises the field via the helper that reads it. Required.        |
| New UI component                        | Component test if it has non-trivial state. Layout-only is exempt.      |
| Bug fix                                 | Reproducer test that fails before the fix, passes after. Required.      |
| Pure cosmetic / docs change             | No test required.                                                       |

If you skip a test on a non-cosmetic change, write a one-line
note in the commit message explaining why ("untestable without
real Gmail OAuth — covered by the manual-test plan in
`docs/AUTH_PLAN.md`"). Don't just silently skip.

### Tests run on every commit

`.husky/pre-commit` runs `npm run precommit` which is:

1. `npm run typecheck` — `next typegen && tsc --noEmit`
2. `npm run lint` — ESLint with `--max-warnings 0`
3. `npm run test:related -- <staged src .ts/.tsx files>` — i.e.
   `vitest related --run`, which runs only the test files whose import
   graph reaches a staged file (deleted files excluded). Skipped when
   no `src/` TypeScript file is staged.

(`npm run precommit` is steps 1 and 2; the hook adds step 3.) and, only when `prisma/schema.prisma` or `prisma/migrations/` is
staged, `npm run check:migrations` (applies every migration to a
scratch database and diffs it against `schema.prisma`, ADR-016).

The hook deliberately does NOT run the whole suite. Related-test
selection follows static imports, so it can miss a test that only
reaches your change through a dynamic import, a config/schema file, or
shared DB state: run `npm test` (full suite) before pushing. For a fast
local loop use `npm run test:related -- <files>`, `npm run test:watch`,
or a single file with `npx vitest run path/to/file.test.ts`.

**CI** (`.github/workflows/test.yml`, on push and pull request to
`main`) is the full-suite gate: Postgres 17 service container, Node 24,
`npm ci`, `prisma generate`, typecheck, lint, then `npm test` in a
matrix of `TZ=America/Denver` and `TZ=UTC` with `TEST_DATABASE_URL`
pointing at the service. It needs no secrets (tests are hermetic) and no
docker CLI: `integration-setup.ts` talks to Postgres through `pg`. The
Prisma agent-consent variable is only needed when an AI agent drives
Prisma locally; CI is not one.

**Bypass** (`git commit --no-verify`) is allowed only for
work-in-progress branches that you'll clean up before merging.
Never for `main`.

The test DB's schema-push step refuses to run without consent text in
`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` when an AI agent drives
Prisma (the container is local and disposable, but Prisma can't tell);
agent sessions export it for the hook.

---

## Layers

We organize tests into three layers, ordered from "fast and
plentiful" to "slow and judicious":

### Layer 1 — Unit tests for pure helpers

Files in `src/lib/**` that don't touch the DB, the filesystem,
or the network. Fast (millisecond-level), no setup, every
public export tested.

What's already covered:

- `lib/sol.ts` — pack/unpack/compute/format
- `lib/billing-form.ts` — state machine, void/delete guards, labels
- `lib/format-date.ts` — variants, relative tiers, day buckets
- `lib/format-phone.ts` — null/empty/10-digit/11-digit/extension/vanity
- `lib/permissions.ts` — catalog shape, isKnownPermission,
  permissionLabel, expected-key smoke list
- `lib/conflict-check.ts` — `normalize` + `summarizeMatchSeverity`
- `lib/calendar-utils.ts` — weekday math, param parse / round-trip,
  hour labels, overlap layout, `eventDayKeys`
- `lib/matters-filters.ts` — URL parse + build round-trip, default
  fallthroughs, sort + view modes, multi-value array handling
- `lib/dashboard-prefs.ts` — `mergeVisibility` + `mergeOrder`
  defensive merges, `cardsInColumn`, `moveCardInColumn` swap/edge
  semantics
- `lib/note-constants.ts` — catalog shapes, today/next-hour
  helpers, `newCapture` factory by kind
- `lib/capture-schemas.ts` — zod validators per kind (task /
  event / deadline / time / note-sibling), event time-order
  cross-check, discriminated-union routing
- `lib/expense-constants.ts` + `lib/matter-team-constants.ts` —
  catalog shape

When you add a new file in `src/lib/` that exports pure functions,
write a sibling `*.test.ts` for it. No exceptions.

### Layer 2 — Component / hook tests

Client components with non-trivial state (forms, dialogs, the
matrix UI, optimistic toggles). Use `happy-dom` (already
configured) + `@testing-library/react` + `@testing-library/user-event`.
Setup file at `src/test/setup.ts` wires the jest-dom matchers
and runs `cleanup()` after every test.

What's covered (representative; `ls src/components/**/*.test.tsx` for the rest):

- `PermissionsMatrix` — read-only mode, locked Admin column,
  toggle calls action with right args, optimistic flip,
  revert + warning on error.
- `ExpenseComposer` — collapsed → expanded states, receipt
  picker shown only when documentOptions is non-empty,
  validation error inline + top-level error rendering, success
  flow resets the form.
- `SettlementApprovals` — Approve/Reject/Reset wire to action
  with the right approval id + status, optional inline note
  passed through, settlement-locked state hides every button,
  canApprove=false hides every button, counter header reflects
  approved + rejected counts.
- `ConflictCheckCard` — full status-pill matrix (pending /
  clear / warn / conflict / override), Run button visibility +
  label switch ("Run" vs "Re-run"), Override workflow opens +
  rejects <5 char justifications + posts FormData with notes,
  saved override rationale read-only when status=override,
  matches list deep-links to contact + matter targets.

Async server components (reply-section, compose-email-launcher) are
tested by awaiting the component function and rendering its result.
Billing/capture/note component tests that mock `@/lib/permission-check`
must also mock `requirePermissions` (delegating per key to the
`requirePermission` mock) because capture and note actions call it.

**Mocking pattern:** stub the imported server action at module
level via `vi.mock("@/app/actions/foo", () => ({ ... }))`. The
test sets `mockedAction.mockResolvedValue(...)` per-case to
control happy / failure paths. Don't go through the action's
real validation — that's covered at layer 1 / layer 3.

**Querying inputs:** the project's form helpers don't always
associate `<label>` to inputs via `htmlFor` (most are siblings),
so `getByLabelText` doesn't always work. Prefer
`container.querySelector('[name="foo"]')` for inputs by name,
`screen.getByRole("button", { name: /foo/i })` for buttons,
`screen.getByPlaceholderText(...)` for fields with stable
placeholders. Document this trap in any new component test that
hits it.

### Layer 3 — Server action / Prisma integration tests

Real DB, real Prisma, real action. Slower (50–500ms per test) —
use selectively for the highest-leverage workflows.

**Infrastructure** (already wired):

- Tests run against a **dedicated dockerized Postgres** (tmpfs,
  port 5433) started with
  `docker compose -f docker-compose.test.yml up -d`. The
  container outlives test runs (restart it to wipe state); your
  dev `DATABASE_URL` is never touched.
- `TEST_DATABASE_URL` overrides the target database (default
  `.../lawcrm_test` on :5433). The name must start with `lawcrm_test`
  and the host must be local: `src/test/test-db-guard.ts` refuses
  anything else, in both `globalSetup` and `resetDb()`, because setup
  force-pushes the schema and every test deletes all rows.
- `src/test/integration-setup.ts` — Vitest `globalSetup` that
  runs ONCE before any test loads. Points `DATABASE_URL` /
  `DIRECT_DATABASE_URL` at the test container, sets
  `DATABASE_POOL_MAX=4` (so lock-contention tests really overlap),
  waits up to 30s for the DB, takes a **per-database advisory run
  lock**, pushes the current schema via
  `npx prisma db push --accept-data-loss` into the base database, then
  clones it into the per-worker databases (next bullet).
- **Per-worker databases.** The base database (`lawcrm_test`, or
  `TEST_DATABASE_URL`) is only a template. `globalSetup` drops and
  recreates `<base>_w1 .. <base>_wN` with
  `CREATE DATABASE ... TEMPLATE <base>` (N = `maxWorkers`), and the
  setupFile `src/test/worker-db-setup.ts` (first in `setupFiles`) points
  each worker's `DATABASE_URL` at `<base>_w<VITEST_POOL_ID>` before
  `@/lib/prisma` loads. Test files therefore run in parallel without
  sharing rows; `resetDb()` only wipes the worker's own database.
  `maxWorkers` is half the cores capped at 4 (`TEST_MAX_WORKERS`
  overrides; helpers in `src/test/test-db-config.ts`). The worker URLs
  still pass `test-db-guard.ts` (`lawcrm_test_w3` matches). Because
  `TEMPLATE` needs zero connections on the base database, the run lock
  is held on the `postgres` maintenance database, keyed by
  `(RUN_LOCK_KEY, hashtext(base name))`. The `_wN` databases are left
  in place between runs (refreshed next run); drop them with
  `DROP DATABASE` if you want them gone. Concurrency tests
  (`billing.concurrency.test.ts`, advisory-lock and parallel-login
  tests) stay correct since each file has a private database; nothing
  needs to run serially.
- **Run lock.** A second one-shot `vitest` run against the SAME
  database (a commit hook plus a manual `npm test`, two agent
  sessions) queues behind the first instead of truncating its rows,
  and fails with a clear error after `TEST_DB_LOCK_TIMEOUT_MS`
  (default 10 min). Watch and `--ui` sessions don't hold the lock.
  Run suites in parallel only on separate databases (see
  "Parallel suites" below). This replaces the old "two vitest
  processes race" limitation.
- `src/test/setup.ts` makes tests hermetic: it deletes
  `BLOB_READ_WRITE_TOKEN`, `STORAGE_DRIVER`, `CRON_SECRET`, Google and
  `AUTH_URL` variables from the environment, sets a deterministic
  `EMAIL_TOKEN_KEY`, and blocks `fetch` to any non-loopback host
  (mock fetch in the test).
- `src/test/integration-helpers.ts` — `resetDb()` deletes
  every table in FK-safe order (new tables must be added to its
  explicit list); fixture builders (`seedFirm`,
  `seedUser`, `seedPracticeArea`, `seedMatter`, `seedTimeEntry`,
  `seedExpense`, `seedContact`, `seedMatterContact`, `seedLead`)
  return the row id for chaining.
- `vitest.config.ts` sets `fileParallelism: true` with
  `maxWorkers` from `resolveMaxWorkers()`; safe because every worker has
  its own database. Tests within a file still run sequentially via
  `beforeEach { resetDb() }`. Never open a connection to the base
  `lawcrm_test` database from a test; use `DATABASE_URL`.

**Mocking pattern** for action tests:

```ts
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// Mock the permission gate when the test is about action logic,
// not authorization. requirePermission's correctness is covered
// in `permission-check.integration.test.ts`.
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

// next/navigation.redirect throws an internal error in prod —
// for tests, stub it to throw something we can assert on:
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
```

**Representative coverage** (the counts that used to be kept here
drifted; read the files):

- `src/app/actions/billing.test.ts` —
  `generateInvoiceFromWip` rolls billable time + expenses into
  one invoice with the right subtotal; flips entries to
  `status="billed"` + stamps `invoiceId`; ignores already-invoiced
  rows; ignores non-billable; refuses when nothing is bundleable.
  `setInvoiceStatus("void")` unlinks both buckets back to
  billable.
- `src/app/actions/settlements.test.ts` —
  `upsertSettlement` seeds the 4-step approval chain on create,
  doesn't re-seed on update, computes firm fee from percent.
  `setApprovalStepStatus` auto-promotes to "approved" only when
  every step approves; snapshots approverId + clears on
  reject/reset; refuses on disbursed/closed. `addSettlementLien`
  refuses on disbursed settlements.
- `src/lib/conflict-check.integration.test.ts` — the
  matcher against the real DB: email + opposing-side
  MatterContact → conflict, email + non-opposing → warn, exact
  name match against `Matter.opposingParty` /
  `.opposingFirm` → conflict, organization match → warn,
  archived matters skipped, severity rolls up correctly.
- `src/lib/permission-check.integration.test.ts` — Admin
  short-circuits to all-granted; non-admin grants flow through
  `RolePermission` rows; multi-role union; inactive user gets
  nothing (even with Admin); `requirePermission(...)` throws
  redirect on miss; `currentUserHasAnyPermission([...])` matches
  the doc.
- `src/lib/firm.integration.test.ts` — `getCurrentFirm`
  returns the user's firm profile, throws on stale-session /
  data-integrity bug; `isCurrentUserAdmin` returns true only for
  active users with the Admin role; `requireAdmin` returns userId
  for admins, throws redirect for non-admins or inactive admins.
- `src/lib/activity-log.test.ts` — `logActivity` writes the
  row + revalidates the dashboard; default icon + source mapping
  per ActivityType (with explicit overrides honored); fire-and-
  forget contract — DB failures (FK violations) are swallowed
  with a `console.warn` so the user's underlying action stays
  the source of truth.
- `src/app/actions/tasks.test.ts` — `setTaskStatus`
  completedAt mirroring (set on enter, clear on leave, preserved
  across done↔cancelled), unknown-status / missing-task guards;
  activity log fans out only on completed-state transitions
  ("Task completed" / "Task cancelled" / "Task reopened").
  `deleteTask` removes + 404s. `updateTask` zod validation,
  dueDate parsing, completedAt mirroring on status change.
- `src/app/actions/deadlines.test.ts` —
  `setDeadlineStatus` only completed stamps completedAt; waived
  / open / overdue clear it; re-completing preserves the
  original timestamp; missing-deadline + unknown-status guards.
  `deleteDeadline` + `updateDeadline` (validation, dueDate parse,
  null-coercion of optional sourceRef + description).
- `src/app/actions/matter-pins.test.ts` — `toggleMatterPin`
  pins → unpins → re-pins idempotently and revalidates the
  layout tree; pins are scoped per (user, matter) so two users
  can pin the same matter without interfering.
- `src/app/actions/time-entries.test.ts` —
  `createTimeEntry` validation (hours > 0, ≤ 24, non-empty
  activity) + matter existence guard + source field write
  (manual vs calendar). `updateTimeEntry` billed-row guard +
  field updates. `setTimeEntryStatus` enum guard. `deleteTimeEntry`
  refuses billed entries (accounting hygiene). RBAC gates:
  create hits `time_entries.create`; edit + delete + status
  bypass on author and gate on `time_entries.{edit,delete}_any`
  for non-author actors.

Billing action tests live in `src/app/actions/billing*.test.ts`;
`billing.concurrency.test.ts` mocks `@/lib/prisma` with a multi-connection
pool (`max > 1`) and waits on `pg_stat_activity` to prove real lock
contention. Time-entry writes are conditional single-statement updates
(they race with invoice generation), tested with a
`vi.spyOn(prisma.x, "findUnique")` stale-read pattern. Other specialised
suites: `src/lib/capture-access.test.ts`, `src/lib/capture-defaults.test.ts`,
`src/lib/text-to-html.test.ts`.

### Static guard tests

- **`src/app/page-guards.test.ts`** scans every `page.tsx` and
  `layout.tsx` under `src/app/(dashboard)` and `src/app/print` and fails
  unless the default export's FIRST `await` is a session guard
  (`requireUser`, `requirePermission`, `requireAdmin` or
  `getCurrentUserId`) with no `prisma.` access before it (ADR-028).
  `PAGE_ALLOWLIST` (keep it empty) and `LAYOUT_ALLOWLIST` (the
  dashboard and print layouts) are the only exemptions; any new entry
  needs a justifying comment.
- `src/lib/permissions.test.ts` scans production sources and fails if a
  literal key passed to `requirePermission`, `requirePermissionResult` or
  `currentUserHasPermission` is not in the catalog.
- `src/vercel-config.test.ts` pins the proxy's self-authenticated paths
  (cron endpoints, blob callback).

---

## File conventions

- One test file per source file, sibling-located: `foo.ts` →
  `foo.test.ts`. Don't create a separate `__tests__/` directory.
- Test files use `describe` / `test` (not `it` — pick one and
  stick with it; the existing suite uses `test`).
- Group related assertions under a `describe`. One assertion per
  test where practical — readable failures > clever DRY.
- Use `toMatch(/regex/)` over `toBe("exact string")` for any
  output that goes through `Intl` (date / number formatting
  varies across Node versions in subtle ways).
- Pin time with `vi.useFakeTimers() + vi.setSystemTime(...)` for
  any test that depends on "now."
- Cover the empty / null / negative / zero edge cases explicitly
  — the bug is almost never in the happy path.

---

## What NOT to test

- Implementation details that aren't part of the public surface.
  Test the export, not the closure inside it.
- Layout / pixel-perfect rendering. Snapshot tests for visual
  output rot fast and add little signal — skip them.
- Network calls to third-party services in unit tests. Mock the
  adapter layer or move the assertion to a dedicated integration
  suite that runs less often.
- Things the type system already catches. `expect(x).toBeDefined()`
  on something that's `string` (not `string | undefined`) is
  noise.

---

## Running tests

| Command                  | What                                                                |
|--------------------------|---------------------------------------------------------------------|
| `npm test`               | One-shot: full suite, exit 1 on failure. Needs the Docker test DB.  |
| `npm run test:watch`     | Watch mode — re-runs on save. TDD default.                          |
| `npx vitest related <files> --run` | Only tests that import the given source files. Fast local loop; still needs the test DB. |
| `npm run test:ui`        | Vitest UI dashboard at `http://localhost:51204/__vitest__/`.        |
| `npm run test:utc`       | Full suite with `TZ=UTC` — the production server's zone.            |
| `npm run test:coverage`  | `vitest run --coverage`; the only place coverage thresholds apply.  |
| `npm run typecheck`      | `next typegen && tsc --noEmit`.                                      |
| `npm run lint`           | ESLint, `--max-warnings 0`.                                          |
| `npm run check:migrations` | Migrations vs `schema.prisma` drift check (hook runs it when `prisma/` is staged). |
| `npm run precommit`      | `typecheck` + `lint` + `test`. The pre-commit hook runs this.        |

The pre-commit hook lives in `.husky/pre-commit` and is wired
via `npm run prepare` (auto-runs after `npm install`).

**Run `test:utc` before shipping anything that touches dates.**
Production runs in UTC while developers (and their browsers) sit
west of it; a bug that mixes the two frames passes in one zone and
fails in the other, so date work should be green in both.

**Parallel suites.** (Files inside ONE run are already parallel, see
"Per-worker databases" in Layer 3; this is about two separate runs.)
Each base database is single-tenant and guarded by a run
lock (see Layer 3). Integration tests default to the `lawcrm_test`
database on `localhost:5433`. Set `TEST_DATABASE_URL` to run a second
suite at the same time against its own database in the same
container (`docker exec lawcrm-test-postgres createdb -U lawcrm_test
lawcrm_test_2`, then `TEST_DATABASE_URL=postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test_2`).
A second run against the same database waits for the first to finish.

---

## Coverage

`npm run test:coverage` produces a v8 coverage report. The
config (in `vitest.config.ts`) scopes coverage to `src/lib/**` and
`src/app/actions/**` — the rest is UI / wiring whose value is
better measured by component + integration tests.

**The floor lives in the `coverage.thresholds` block of
`vitest.config.ts` — that's the source of truth, not this doc**
(a snapshot here drifted stale within weeks; don't reintroduce one).
Thresholds are enforced only under `--coverage`; the commit hook runs
the plain suite.

The target is "every public function in `src/lib/` has a test."
We're not there yet — a lot of the gap is `src/app/actions/**`
(server actions that need DB integration tests) and trivial
`*-form.ts` initial-state files where there's no logic to cover.

**Raising the floor:** when you add tests that bump the numbers
materially, edit the `coverage.thresholds` block in
`vitest.config.ts` upward in the same PR. Don't ratchet it past
the current value — leave a few points of headroom so refactors
that legitimately move uncovered lines don't trip the check.

**Lowering the floor is not allowed.** If a change would lower
coverage, fix the tests first.

---

## Adding a test for a new feature

1. Open the source file you're changing.
2. Open the sibling `*.test.ts` (create it if it doesn't exist).
3. Add a `describe` block for the new behavior.
4. Add at least one positive case + at least one negative case
   (null / wrong type / out-of-range input / unauthorized).
5. Run `npm run test:watch` (or `npx vitest related <file> --run`) and iterate until green.
6. Run `npm run test:utc` too if the code touches dates (ADR-012).
7. Commit. The pre-commit hook re-runs typecheck, lint and the whole suite
   before the diff lands.

For features that span multiple files (a server action with a
client form), put the unit-level tests on the pure helpers and
write a single representative integration test for the
end-to-end flow.

---

## Change log

| Date       | Change                                                                                    |
|------------|-------------------------------------------------------------------------------------------|
| 2026-04-27 | Vitest + happy-dom installed. 103 tests landed across 7 helper files. Pre-commit hook wired via husky. `docs/TESTING.md` added. |
| 2026-04-27 | Layer 2 testing wired: `@testing-library/react` + user-event installed, `src/test/setup.ts` registers jest-dom matchers + auto-cleanup. 49 component tests landed for `PermissionsMatrix` / `ExpenseComposer` / `SettlementApprovals` / `ConflictCheckCard`. Suite is 152 tests across 11 files in 1.3s. |
| 2026-04-27 | Layer 3 testing wired. `src/test/integration-setup.ts` is a Vitest `globalSetup` that points DATABASE_URL at a dedicated `prisma/test.db`, runs `prisma db push` once, and tears the file down. `src/test/integration-helpers.ts` exposes `resetDb()` + fixture builders (`seedFirm`, `seedUser`, `seedMatter`, etc). 42 integration tests across 4 files cover `generateInvoiceFromWip` bundling + void unlink, settlement waterfall + approval chain auto-promotion, conflict matcher against real Contacts + matters, `requirePermission` gate behavior. `fileParallelism: false` keeps integration files from racing on the shared DB. Full suite: 194 tests across 15 files in ~7s. |
| 2026-04-25 | Coverage push. New layer-1 tests for `format-phone`, `calendar-utils`, `matters-filters`, `dashboard-prefs`, `note-constants`, `capture-schemas`, plus a `file-storage` test that uses `process.chdir(mkdtempSync(...))` + dynamic import to control STORAGE_ROOT. New layer-3 tests for `firm.ts` admin helpers and the `activity-log` writer (icon/source mapping + fire-and-forget contract). Coverage threshold floors landed in `vitest.config.ts` (lines 17 / statements 17 / functions 17 / branches 15) — current numbers ~17.8%. Full suite: **361 tests across 24 files in ~12s**. |
| 2026-04-25 | Coverage push round 2 + Button wrapper fix. Layer-3 tests for the task action surface (`setTaskStatus` / `updateTask` / `deleteTask` — completedAt mirroring + activity-log fan-out), the deadline action surface, and `toggleMatterPin` (idempotent toggle, per-user scoping). New layer-2 test for the Button wrapper locks in `nativeButton: false` inference when a `render` element is supplied — fixes a noisy console warning that fired across `/matters`, `/contacts`, `/intake`, and the catch-all not-found page when Button rendered a `<Link>` (anchor) via `render`. Threshold floors raised to lines 20 / statements 20 / functions 19 / branches 18. Full suite: **406 tests across 28 files in ~15s**. |
| 2026-04-25 | RBAC gating sweep + time-entry tests. Closed all seven `TODO (auth)` markers in the action layer. Added six permission categories (`tasks`, `deadlines`, `notes`, `time_entries`, `parties`, `events`) with 20 new keys following the granularity convention; user-authored rows (notes, time entries) use the `_any` suffix only when crossing the ownership line, mirroring `documents.delete_any`. Wrapped `requirePermission(...)` around mutating actions in `tasks.ts`, `deadlines.ts`, `notes.ts`, `time-entries.ts`, `parties.ts`, `captures.ts`, and the `updateMatter` / `updateMatterStage` / `setMatterSolSatisfied` paths. Added a new `time-entries.test.ts` (22) covering create/update/status/delete plus the author-vs-`_any` gate logic. Existing `tasks.test.ts` + `deadlines.test.ts` got "RBAC gate" describe blocks asserting each action wires the right permission key. Threshold floors raised to lines 22 / statements 22 / functions 20 / branches 20. Full suite: **453 tests across 29 files in ~15s**. |
| 2026-04-28 | Migrated the whole stack (prod + tests) from SQLite to Postgres. Integration tests now run against a dockerized tmpfs Postgres on port 5433 (`docker compose -f docker-compose.test.yml up -d`); `integration-setup.ts` waits for the container and pushes the schema instead of managing a `test.db` file. |
| 2026-07-06 | Doc catch-up: layer-3 infrastructure section updated for the Postgres container (was still describing `prisma/test.db`), coverage snapshot table replaced with a pointer to `vitest.config.ts` (floors had moved to 24/24/23/22 without the doc noticing — commit 39ce382). Suite at this point: **712 tests across 48 files in ~25s**. |
| 2026-07-07 | In-app notifications finish-out. New layer-3 files: `lib/notification-sweeps.test.ts` (12 — bucket edges, (userId, type, link) idempotency across re-runs + threshold progression, owner-vs-team recipients, archived-matter skip, hourly throttle + never-throws contract) and `lib/notification-type-meta.test.ts` (3). Extended: `actions/tasks.test.ts` (+7, `setTaskOwner` assignment/notification/actor-exclusion/guards + gate), `actions/settlements.test.ts` (+5, approval fan-out recipients + silence on repeats/resets), `actions/notifications.test.ts` (+3, `getNotificationsFeed` pagination/clamping/scoping), `notification-bell.test.tsx` (+2, "View all" footer; the next/link mock now composes the caller's onClick before preventDefault). Suite: **1330 tests across 124 files in ~64s**. |
| 2026-07-07 | Dashboard customizable layout v2 (reorder). Layer-1 `lib/dashboard-prefs.test.ts` grew to 34 (was 12) — `mergeOrder` mirrors `mergeVisibility`'s defensive-merge suite (fallthroughs, unknown/non-string/dupe entries, post-save keys appended, permutation invariant), plus `mergePrefs`, `cardsInColumn`, and `moveCardInColumn` (swap within column, null at edges, cross-column isolation, no input mutation). New layer-3 `actions/dashboard-prefs.test.ts` (7 — the two actions never clobber each other's half of the blob, server-side order sanitization, unknown-key guard, no-prior-prefs path). New layer-2 `dashboard/customize-button.test.tsx` (7 — rows grouped by column in pref order, hidden rows stay orderable, edge-disabled arrows, optimistic reorder + full-order payload, rollback on failure, v1 checkbox regression). |
| 2026-07-07 | Contact bulk operations. New layer-1 `lib/csv.test.ts` (10 — RFC 4180 escaping/quote doubling, null → empty cell, formula-injection guard for `=`/`@` with `+`/`-` deliberately exempt, CRLF document shape). `actions/contacts.test.ts` grew a bulk suite: gates (`bulkSetContactType` → contacts.edit, `bulkDeactivateContacts` → contacts.delete, `exportContactsCsv` session-only — pinned to NOT call requirePermission), all-or-nothing id validation + the 100-row `BULK_CONTACT_LIMIT`, id dedupe, inactive/merged rejection on re-type, ONE-summary-audit-row contract per bulk op, CSV escaping + address folding + active column. New layer-2 `contacts/contacts-table.test.tsx` (9 — selection bar count / select-all / Clear, set-type wiring + alert-and-keep-selection on failure, confirm()-gated deactivate, export blob download, canEdit/canDelete hiding, over-cap trim note). happy-dom trap documented in-file: `window.alert`/`confirm` don't exist — `vi.stubGlobal`, not `vi.spyOn`. |
| 2026-07-07 | Timer widget + time entry v2. New layer-1 `lib/time-entry-constants.test.ts` (17 — rounding UP to the quarter-hour increment with a one-increment floor, elapsed formatting, start–end hour math incl. no-overnight rule, UTBMS catalog shape + `isKnownUtbmsCode` guard); new layer-3 `actions/timer.test.ts` (15 — start replaces via the userId unique, update preserves the clock + partial-field semantics, discard idempotent, stop writes `source:"timer"` + deletes the session in one transaction, matter-required + stale-dialog double-log guards, permission posture: start/update/discard hit NO key, `stopTimer` gates on `time_entries.create`); `actions/time-entries.test.ts` +4 (utbmsCode persist/clear/reject on create + update); new layer-2 `captures/time-composer.test.tsx` (4 — UTBMS posts as `utbmsCode`, start–end mode computes and posts plain `hours`, incomplete range keeps Save gated). `timer_sessions` added to `resetDb()`'s delete order. Suite: **1334 tests across 125 files in ~60s**. |
| 2026-07-07 | Gmail sync engine (integration phase 2). New layer-1 `lib/google/gmail-message-parse.test.ts` (27 — RFC 5322 address-list subset incl. quoted-comma names + RFC 2047 B/Q encoded words, base64url, MIME walk against multipart/alternative + nested multipart/mixed fixtures, attachment-part exclusion from body extraction, label→flag mapping + the Label_*-only user-label filter, snippet entity decoding). `lib/sanitize-html.test.ts` +12 for the new EMAIL profile — a hostile-mail fixture pins the write-time boundary (script payload gone, handlers/javascript: stripped, iframe/form/style discarded, safe inline-style subset kept while position/url() drop, remote + cid: images → "[image blocked]" placeholder with alt preserved, data: images render) plus not-loosened checks on the note/document profiles. New layer-3 `lib/google/gmail-sync.test.ts` (14 — `gmailFetch` mocked as a URL-dispatching fake Gmail, DB real: history-vs-full path selection, historyId-404 → full fallback, provider-404 keeps the local thread, idempotent re-upsert on the externalId uniques, app-owned preservation across resync (matterId/followUpAt/isPrivileged/app labels/downloaded attachment fileUrl) while provider columns update, custom:* label reconciliation, hostile-body sanitization end-to-end, 200-thread initial-import cap + newer_than:90d query, GmailAuthError marks `error` vs transient restore-and-rethrow + syncError clear on next success, per-user account scoping, `maybeKickEmailSync` throttle/staleness/never-throws). New `actions/email-sync.test.ts` (3 — identity scoping, empty-account no-op without revalidation, per-account failure surfacing) and `api/email-sync/route.test.ts` (4 — CRON_SECRET fail-closed idiom, no email addresses in cron output, 500-without-leak). (Superseded: a per-database run lock now queues concurrent runs; see Layer 3.) |
| 2026-07-07 | Gmail send/reply (integration phase 3). New layer-1 `lib/google/mime.test.ts` (53 — address validation matrix + comma/semicolon list parsing with case-insensitive dedupe, RFC 2047 subject/display-name encoding incl. multi-word chunking that reassembles + header-injection stripping (no smuggled header LINE), RFC 2822 date, multipart/alternative shape with 76-col base64 part bodies that decode to the exact composer content, Message-ID omission, In-Reply-To/References angle-bracketing, boundary non-collision, unwrapped base64url `raw` round-trip via Buffer decode, plainTextToHtml escaping/paragraphs, Re:-no-stacking, deriveReplyRecipients matrix: last-inbound anchor, reply-all From+To+Cc minus own address case-insensitively, To-wins-over-Cc dedupe, all-outbound fallback). New layer-3 `actions/email-send.test.ts` (24 — `gmailFetch` stubbed with real error classes via importOriginal, DB real: `communication.send_email` gate on both actions, ownership scoping (foreign accountId/thread → not-found, no network call), disconnected-account refusal, recipient/body validation before the wire, MIME payload decoded off the wire (From/To/Cc/Subject/threadId pin), local upsert convergence on the sync engine's (accountId|threadId, externalId) uniques incl. pre-existing-row reuse + idempotent repeat + null-externalId linking, filed-thread activity log, GmailAuthError/GoogleOAuthError/HTTP-429 all return `{ok:false}` with zero local rows). New layer-2 `compose-email.test.tsx` (8) + `reply-composer.test.tsx` (10) — no-account Connect-Gmail link, single vs multi account picker, invalid-address inline block, error-preserves-draft contract, success reset+refresh, reply prefill read-only until Edit, unedited sends carry NO overrides (server re-derives), reply-all wiring, empty-derivation opens edit mode. happy-dom trap documented in-file: Base UI render-prop anchors don't expose an accessible name to getByRole — query by text + closest("a"). |
| 2026-07-08 | Google Calendar pull sync + scope plumbing. New layer-3 `lib/google/google-calendar-sync.test.ts` (19 — `gmailFetch` mocked as a fake Google Calendar, DB real: scope gating with zero traffic for unscoped/null-grant accounts, full windowed pull param pins (timeMin/timeMax ≈ now−30d/now+400d, `singleEvents=true`), unmarked import shape (createdById = connection owner / visibility default / type meeting / matterless + mapping row), pagination-then-nextSyncToken persistence, incremental syncToken flow + 410 GONE → full re-pull, marked-event mapping upsert + last-write-wins both directions (older Google `updated` never overwrites; marker to a deleted CRM event never resurrects), the full cancellation-rule matrix (sole-mapping personal → event deleted; filed / other-attendee / multi-mapping → mapping-only), GmailAuthError account flip vs transient note-and-rethrow + calendar-prefixed syncError hygiene (a calendar success never clears an email failure note), per-user wrapper isolation, and an import-statement scan pinning echo safety — the pull module must never import `google-calendar-push` or the calendar-events actions). Extended: callback `route.test.ts` (+1 and hardened — `grantedScopes` persisted on connect AND reconnect, absent `scope` keeps the prior grant), connect `route.test.ts` (calendar scope in the consent URL), `actions/email-sync.test.ts` (+3 — Sync-now piggyback imports events, unscoped accounts skip without /calendar revalidation, calendar failure never flips the mail verdict), cron `route.test.ts` (+1 — calendar summary by account id only; wholesale pull failure never fails the sweep), `gmail-integration-card.test.tsx` (+3 — "Calendar sync on" vs reconnect-link scope line, hidden on disconnected rows). `calendar_event_syncs` added to `resetDb()`'s delete order; new `seedCalendarEvent` fixture builder. |
| 2026-10-17 | Quality-sweep catch-up: pre-commit now runs lint; documented `TEST_DATABASE_URL`, the run lock and DB-name guard, `DATABASE_POOL_MAX=4`, the hermetic env scrub and network block, `test:utc`, `vitest related`, the page-guards static test. Hand-kept per-file test counts removed (read the files). |
| 2026-10-17 | Suite speed-up. `vitest.config.ts` now has two projects: `dom` (happy-dom, `*.test.tsx`) and `node` (`*.test.ts`); a `.ts` test that needs DOM APIs opts in with `// @vitest-environment happy-dom`. `setup.ts` loads jest-dom/RTL only when a DOM exists. `resetDb()` is a single `DO $$ ... DELETE ... $$` statement (benchmarked ~1-4ms vs ~10ms batched DELETEs vs ~37ms TRUNCATE CASCADE). Password hashing goes through `lib/argon2-options.ts` (cheap params only when `NODE_ENV=test`; prod params pinned by test). `syncEmailAccount` takes a `fullSyncMaxThreads` test seam. `globalSetup` is idempotent per process (projects invoke it once each). CI: 2 shards per TZ, `TEST_MAX_WORKERS=4`. |
