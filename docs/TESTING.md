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

- Tests run against a **dedicated dockerized Postgres** (tmpfs,
  port 5433) started with
  `docker compose -f docker-compose.test.yml up -d`. The
  container outlives test runs (restart it to wipe state); your
  dev `DATABASE_URL` is never touched.
- `src/test/integration-setup.ts` — Vitest `globalSetup` that
  runs ONCE before any test loads. Points `DATABASE_URL` /
  `DIRECT_DATABASE_URL` at the test container, waits up to 30s
  for it to accept connections, then pushes the current schema
  via `npx prisma db push --accept-data-loss`.
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

**What's covered today** (145 integration tests across 10 files):

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
- `src/app/actions/time-entries.test.ts` (22) —
  `createTimeEntry` validation (hours > 0, ≤ 24, non-empty
  activity) + matter existence guard + source field write
  (manual vs calendar). `updateTimeEntry` billed-row guard +
  field updates. `setTimeEntryStatus` enum guard. `deleteTimeEntry`
  refuses billed entries (accounting hygiene). RBAC gates:
  create hits `time_entries.create`; edit + delete + status
  bypass on author and gate on `time_entries.{edit,delete}_any`
  for non-author actors.

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

**The floor lives in the `coverage.thresholds` block of
`vitest.config.ts` — that's the source of truth, not this doc**
(a snapshot table here drifted stale within weeks; don't
reintroduce one). As of 2026-07-06 the floor is lines 24 /
statements 24 / functions 23 / branches 22. Run
`npm test -- --coverage` for current numbers.

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
| 2026-04-25 | RBAC gating sweep + time-entry tests. Closed all seven `TODO (auth)` markers in the action layer. Added six permission categories (`tasks`, `deadlines`, `notes`, `time_entries`, `parties`, `events`) with 20 new keys following the granularity convention; user-authored rows (notes, time entries) use the `_any` suffix only when crossing the ownership line, mirroring `documents.delete_any`. Wrapped `requirePermission(...)` around mutating actions in `tasks.ts`, `deadlines.ts`, `notes.ts`, `time-entries.ts`, `parties.ts`, `captures.ts`, and the `updateMatter` / `updateMatterStage` / `setMatterSolSatisfied` paths. Added a new `time-entries.test.ts` (22) covering create/update/status/delete plus the author-vs-`_any` gate logic. Existing `tasks.test.ts` + `deadlines.test.ts` got "RBAC gate" describe blocks asserting each action wires the right permission key. Threshold floors raised to lines 22 / statements 22 / functions 20 / branches 20. Full suite: **453 tests across 29 files in ~15s**. |
| 2026-04-28 | Migrated the whole stack (prod + tests) from SQLite to Postgres. Integration tests now run against a dockerized tmpfs Postgres on port 5433 (`docker compose -f docker-compose.test.yml up -d`); `integration-setup.ts` waits for the container and pushes the schema instead of managing a `test.db` file. |
| 2026-07-06 | Doc catch-up: layer-3 infrastructure section updated for the Postgres container (was still describing `prisma/test.db`), coverage snapshot table replaced with a pointer to `vitest.config.ts` (floors had moved to 24/24/23/22 without the doc noticing — commit 39ce382). Suite at this point: **712 tests across 48 files in ~25s**. |
| 2026-07-07 | In-app notifications finish-out. New layer-3 files: `lib/notification-sweeps.test.ts` (12 — bucket edges, (userId, type, link) idempotency across re-runs + threshold progression, owner-vs-team recipients, archived-matter skip, hourly throttle + never-throws contract) and `lib/notification-type-meta.test.ts` (3). Extended: `actions/tasks.test.ts` (+7, `setTaskOwner` assignment/notification/actor-exclusion/guards + gate), `actions/settlements.test.ts` (+5, approval fan-out recipients + silence on repeats/resets), `actions/notifications.test.ts` (+3, `getNotificationsFeed` pagination/clamping/scoping), `notification-bell.test.tsx` (+2, "View all" footer; the next/link mock now composes the caller's onClick before preventDefault). Suite: **1330 tests across 124 files in ~64s**. |
| 2026-07-07 | Dashboard customizable layout v2 (reorder). Layer-1 `lib/dashboard-prefs.test.ts` grew to 34 (was 12) — `mergeOrder` mirrors `mergeVisibility`'s defensive-merge suite (fallthroughs, unknown/non-string/dupe entries, post-save keys appended, permutation invariant), plus `mergePrefs`, `cardsInColumn`, and `moveCardInColumn` (swap within column, null at edges, cross-column isolation, no input mutation). New layer-3 `actions/dashboard-prefs.test.ts` (7 — the two actions never clobber each other's half of the blob, server-side order sanitization, unknown-key guard, no-prior-prefs path). New layer-2 `dashboard/customize-button.test.tsx` (7 — rows grouped by column in pref order, hidden rows stay orderable, edge-disabled arrows, optimistic reorder + full-order payload, rollback on failure, v1 checkbox regression). |
| 2026-07-07 | Contact bulk operations. New layer-1 `lib/csv.test.ts` (10 — RFC 4180 escaping/quote doubling, null → empty cell, formula-injection guard for `=`/`@` with `+`/`-` deliberately exempt, CRLF document shape). `actions/contacts.test.ts` grew a bulk suite: gates (`bulkSetContactType` → contacts.edit, `bulkDeactivateContacts` → contacts.delete, `exportContactsCsv` session-only — pinned to NOT call requirePermission), all-or-nothing id validation + the 100-row `BULK_CONTACT_LIMIT`, id dedupe, inactive/merged rejection on re-type, ONE-summary-audit-row contract per bulk op, CSV escaping + address folding + active column. New layer-2 `contacts/contacts-table.test.tsx` (9 — selection bar count / select-all / Clear, set-type wiring + alert-and-keep-selection on failure, confirm()-gated deactivate, export blob download, canEdit/canDelete hiding, over-cap trim note). happy-dom trap documented in-file: `window.alert`/`confirm` don't exist — `vi.stubGlobal`, not `vi.spyOn`. |
| 2026-07-07 | Timer widget + time entry v2. New layer-1 `lib/time-entry-constants.test.ts` (17 — rounding UP to the quarter-hour increment with a one-increment floor, elapsed formatting, start–end hour math incl. no-overnight rule, UTBMS catalog shape + `isKnownUtbmsCode` guard); new layer-3 `actions/timer.test.ts` (15 — start replaces via the userId unique, update preserves the clock + partial-field semantics, discard idempotent, stop writes `source:"timer"` + deletes the session in one transaction, matter-required + stale-dialog double-log guards, permission posture: start/update/discard hit NO key, `stopTimer` gates on `time_entries.create`); `actions/time-entries.test.ts` +4 (utbmsCode persist/clear/reject on create + update); new layer-2 `captures/time-composer.test.tsx` (4 — UTBMS posts as `utbmsCode`, start–end mode computes and posts plain `hours`, incomplete range keeps Save gated). `timer_sessions` added to `resetDb()`'s delete order. Suite: **1334 tests across 125 files in ~60s**. |
| 2026-07-07 | Gmail sync engine (integration phase 2). New layer-1 `lib/google/gmail-message-parse.test.ts` (27 — RFC 5322 address-list subset incl. quoted-comma names + RFC 2047 B/Q encoded words, base64url, MIME walk against multipart/alternative + nested multipart/mixed fixtures, attachment-part exclusion from body extraction, label→flag mapping + the Label_*-only user-label filter, snippet entity decoding). `lib/sanitize-html.test.ts` +12 for the new EMAIL profile — a hostile-mail fixture pins the write-time boundary (script payload gone, handlers/javascript: stripped, iframe/form/style discarded, safe inline-style subset kept while position/url() drop, remote + cid: images → "[image blocked]" placeholder with alt preserved, data: images render) plus not-loosened checks on the note/document profiles. New layer-3 `lib/google/gmail-sync.test.ts` (14 — `gmailFetch` mocked as a URL-dispatching fake Gmail, DB real: history-vs-full path selection, historyId-404 → full fallback, provider-404 keeps the local thread, idempotent re-upsert on the externalId uniques, app-owned preservation across resync (matterId/followUpAt/isPrivileged/app labels/downloaded attachment fileUrl) while provider columns update, custom:* label reconciliation, hostile-body sanitization end-to-end, 200-thread initial-import cap + newer_than:90d query, GmailAuthError marks `error` vs transient restore-and-rethrow + syncError clear on next success, per-user account scoping, `maybeKickEmailSync` throttle/staleness/never-throws). New `actions/email-sync.test.ts` (3 — identity scoping, empty-account no-op without revalidation, per-account failure surfacing) and `api/email-sync/route.test.ts` (4 — CRON_SECRET fail-closed idiom, no email addresses in cron output, 500-without-leak). NOTE: layer-3 files assume exclusive use of the :5433 test DB — two `vitest run` processes at once race on `resetDb()`. |
| 2026-07-07 | Gmail send/reply (integration phase 3). New layer-1 `lib/google/mime.test.ts` (53 — address validation matrix + comma/semicolon list parsing with case-insensitive dedupe, RFC 2047 subject/display-name encoding incl. multi-word chunking that reassembles + header-injection stripping (no smuggled header LINE), RFC 2822 date, multipart/alternative shape with 76-col base64 part bodies that decode to the exact composer content, Message-ID omission, In-Reply-To/References angle-bracketing, boundary non-collision, unwrapped base64url `raw` round-trip via Buffer decode, plainTextToHtml escaping/paragraphs, Re:-no-stacking, deriveReplyRecipients matrix: last-inbound anchor, reply-all From+To+Cc minus own address case-insensitively, To-wins-over-Cc dedupe, all-outbound fallback). New layer-3 `actions/email-send.test.ts` (24 — `gmailFetch` stubbed with real error classes via importOriginal, DB real: `communication.send_email` gate on both actions, ownership scoping (foreign accountId/thread → not-found, no network call), disconnected-account refusal, recipient/body validation before the wire, MIME payload decoded off the wire (From/To/Cc/Subject/threadId pin), local upsert convergence on the sync engine's (accountId|threadId, externalId) uniques incl. pre-existing-row reuse + idempotent repeat + null-externalId linking, filed-thread activity log, GmailAuthError/GoogleOAuthError/HTTP-429 all return `{ok:false}` with zero local rows). New layer-2 `compose-email.test.tsx` (8) + `reply-composer.test.tsx` (10) — no-account Connect-Gmail link, single vs multi account picker, invalid-address inline block, error-preserves-draft contract, success reset+refresh, reply prefill read-only until Edit, unedited sends carry NO overrides (server re-derives), reply-all wiring, empty-derivation opens edit mode. happy-dom trap documented in-file: Base UI render-prop anchors don't expose an accessible name to getByRole — query by text + closest("a"). |
| 2026-07-08 | Google Calendar pull sync + scope plumbing. New layer-3 `lib/google/google-calendar-sync.test.ts` (19 — `gmailFetch` mocked as a fake Google Calendar, DB real: scope gating with zero traffic for unscoped/null-grant accounts, full windowed pull param pins (timeMin/timeMax ≈ now−30d/now+400d, `singleEvents=true`), unmarked import shape (createdById = connection owner / visibility default / type meeting / matterless + mapping row), pagination-then-nextSyncToken persistence, incremental syncToken flow + 410 GONE → full re-pull, marked-event mapping upsert + last-write-wins both directions (older Google `updated` never overwrites; marker to a deleted CRM event never resurrects), the full cancellation-rule matrix (sole-mapping personal → event deleted; filed / other-attendee / multi-mapping → mapping-only), GmailAuthError account flip vs transient note-and-rethrow + calendar-prefixed syncError hygiene (a calendar success never clears an email failure note), per-user wrapper isolation, and an import-statement scan pinning echo safety — the pull module must never import `google-calendar-push` or the calendar-events actions). Extended: callback `route.test.ts` (+1 and hardened — `grantedScopes` persisted on connect AND reconnect, absent `scope` keeps the prior grant), connect `route.test.ts` (calendar scope in the consent URL), `actions/email-sync.test.ts` (+3 — Sync-now piggyback imports events, unscoped accounts skip without /calendar revalidation, calendar failure never flips the mail verdict), cron `route.test.ts` (+1 — calendar summary by account id only; wholesale pull failure never fails the sweep), `gmail-integration-card.test.tsx` (+3 — "Calendar sync on" vs reconnect-link scope line, hidden on disconnected rows). `calendar_event_syncs` added to `resetDb()`'s delete order; new `seedCalendarEvent` fixture builder. |
