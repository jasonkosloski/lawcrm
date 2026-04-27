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
  pre-commit hook runs the full suite and the typecheck on every
  commit; failures block.
- **Tests run on every git commit.** Husky pre-commit hook in
  `.husky/pre-commit`.

---

## Discipline

### Every feature gets a test

When you add or change behavior, you also add or update a test.
The bar isn't 100% coverage — the bar is "this thing is exercised
by code that runs in CI before the diff lands." Concretely:

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

1. `tsc --noEmit` — full typecheck
2. `vitest run` — full unit suite

The suite is currently <1s, so this is essentially free. We'll
switch to `vitest related ...` once it grows past 5s, but for now
running everything is the simplest correct thing.

**Bypass** (`git commit --no-verify`) is allowed only for
work-in-progress branches that you'll clean up before merging.
Never for `main`.

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
  hour labels, event positioning, now-line offset
- `lib/matters-filters.ts` — URL parse + build round-trip, default
  fallthroughs, sort + view modes, multi-value array handling
- `lib/dashboard-prefs.ts` — `mergeVisibility` defensive merge
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

What's already covered (49 tests across 4 components):

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

- `src/test/integration-setup.ts` — Vitest `globalSetup` that
  runs ONCE before any test loads. Sets `DATABASE_URL` to
  `file:./prisma/test.db`, deletes any leftover file, and
  pushes the current schema via `npx prisma db push --url ...
  --accept-data-loss`. Teardown deletes the file so re-runs
  start clean.
- `src/test/integration-helpers.ts` — `resetDb()` truncates
  every table in FK-safe order; fixture builders (`seedFirm`,
  `seedUser`, `seedPracticeArea`, `seedMatter`, `seedTimeEntry`,
  `seedExpense`, `seedContact`, `seedMatterContact`, `seedLead`)
  return the row id for chaining.
- `vitest.config.ts` sets `fileParallelism: false` because the
  test DB is shared across files — file-level parallelism would
  race on the shared state. Tests within a file still run
  sequentially via `beforeEach { resetDb() }`.

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

**What's covered today** (123 integration tests across 9 files):

- `src/app/actions/billing.test.ts` (7) —
  `generateInvoiceFromWip` rolls billable time + expenses into
  one invoice with the right subtotal; flips entries to
  `status="billed"` + stamps `invoiceId`; ignores already-invoiced
  rows; ignores non-billable; refuses when nothing is bundleable.
  `setInvoiceStatus("void")` unlinks both buckets back to
  billable.
- `src/app/actions/settlements.test.ts` (10) —
  `upsertSettlement` seeds the 4-step approval chain on create,
  doesn't re-seed on update, computes firm fee from percent.
  `setApprovalStepStatus` auto-promotes to "approved" only when
  every step approves; snapshots approverId + clears on
  reject/reset; refuses on disbursed/closed. `addSettlementLien`
  refuses on disbursed settlements.
- `src/lib/conflict-check.integration.test.ts` (13) — the
  matcher against the real DB: email + opposing-side
  MatterContact → conflict, email + non-opposing → warn, exact
  name match against `Matter.opposingParty` /
  `.opposingFirm` → conflict, organization match → warn,
  archived matters skipped, severity rolls up correctly.
- `src/lib/permission-check.integration.test.ts` (12) — Admin
  short-circuits to all-granted; non-admin grants flow through
  `RolePermission` rows; multi-role union; inactive user gets
  nothing (even with Admin); `requirePermission(...)` throws
  redirect on miss; `currentUserHasAnyPermission([...])` matches
  the doc.
- `src/lib/firm.integration.test.ts` (9) — `getCurrentFirm`
  returns the user's firm profile, throws on stale-session /
  data-integrity bug; `isCurrentUserAdmin` returns true only for
  active users with the Admin role; `requireAdmin` returns userId
  for admins, throws redirect for non-admins or inactive admins.
- `src/lib/activity-log.test.ts` (32) — `logActivity` writes the
  row + revalidates the dashboard; default icon + source mapping
  per ActivityType (with explicit overrides honored); fire-and-
  forget contract — DB failures (FK violations) are swallowed
  with a `console.warn` so the user's underlying action stays
  the source of truth.
- `src/app/actions/tasks.test.ts` (21) — `setTaskStatus`
  completedAt mirroring (set on enter, clear on leave, preserved
  across done↔cancelled), unknown-status / missing-task guards;
  activity log fans out only on completed-state transitions
  ("Task completed" / "Task cancelled" / "Task reopened").
  `deleteTask` removes + 404s. `updateTask` zod validation,
  dueDate parsing, completedAt mirroring on status change.
- `src/app/actions/deadlines.test.ts` (15) —
  `setDeadlineStatus` only completed stamps completedAt; waived
  / open / overdue clear it; re-completing preserves the
  original timestamp; missing-deadline + unknown-status guards.
  `deleteDeadline` + `updateDeadline` (validation, dueDate parse,
  null-coercion of optional sourceRef + description).
- `src/app/actions/matter-pins.test.ts` (4) — `toggleMatterPin`
  pins → unpins → re-pins idempotently and revalidates the
  layout tree; pins are scoped per (user, matter) so two users
  can pin the same matter without interfering.

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
| `npm test`               | One-shot: full suite, exit 1 on failure. CI default.                |
| `npm run test:watch`     | Watch mode — re-runs on save. TDD default.                          |
| `npm run test:ui`        | Vitest UI dashboard at `http://localhost:51204/__vitest__/`.        |
| `npm run typecheck`      | `tsc --noEmit` — catches type errors without an emit.               |
| `npm run precommit`      | `typecheck` + `test`. The pre-commit hook runs this.                |

The pre-commit hook lives in `.husky/pre-commit` and is wired
via `npm run prepare` (auto-runs after `npm install`).

---

## Coverage

`npm test -- --coverage` produces a v8 coverage report. The
config (in `vitest.config.ts`) scopes coverage to `src/lib/**` and
`src/app/actions/**` — the rest is UI / wiring whose value is
better measured by component + integration tests.

**Current floor** (enforced in `vitest.config.ts`):

| Metric     | Floor | Current |
|------------|-------|---------|
| Lines      | 20%   | 20.47%  |
| Statements | 20%   | 20.58%  |
| Functions  | 19%   | 19.79%  |
| Branches   | 18%   | 18.88%  |

The target is "every public function in `src/lib/` has a test."
We're not there yet — a lot of the gap is `src/app/actions/**`
(server actions that need DB integration tests) and trivial
`*-form.ts` initial-state files where there's no logic to cover.

**Raising the floor:** when you add tests that bump the numbers
materially, edit the `coverage.thresholds` block in
`vitest.config.ts` upward in the same PR. Don't ratchet it past
the current value — leave a few points of headroom so refactors
that legitimately move uncovered lines don't trip CI.

**Lowering the floor is not allowed.** If a change would lower
coverage, fix the tests first.

---

## Adding a test for a new feature

1. Open the source file you're changing.
2. Open the sibling `*.test.ts` (create it if it doesn't exist).
3. Add a `describe` block for the new behavior.
4. Add at least one positive case + at least one negative case
   (null / wrong type / out-of-range input / unauthorized).
5. Run `npm run test:watch` and iterate until green.
6. Commit. The pre-commit hook re-runs everything before the
   diff lands.

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
