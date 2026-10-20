# Dashboard v3 Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two fixed dashboard columns with a band + 1–3 column layout the user rearranges by drag in an in-place Customize mode, and give every card one shared frame.

**Architecture:** A pure, Prisma-free layout model (`src/lib/dashboard-prefs.ts`) decodes `User.dashboardPrefs` (v2 or v3) into `DashboardLayout`; one server action saves a sanitized layout. The server page renders card nodes (now one file per card under `src/components/dashboard/cards/`) and hands them to a client `DashboardCustomizer` that lays them out and, in edit mode, rearranges them with @dnd-kit before a single save on Done.

**Tech Stack:** Next.js 16 App Router (server components + server actions), React 19, Tailwind v4 (container queries), Prisma, Vitest + Testing Library, @dnd-kit/core + @dnd-kit/sortable (new), sonner.

**Spec:** `docs/superpowers/specs/2026-10-20-dashboard-v3-layout-design.md`

## Global Constraints

- No schema change; layout lives in `User.dashboardPrefs` (JSON).
- No query, permission, or matter-scope change. Cards gated today (`pulse` needs `reports.view` via its loader returning null, `records` needs `records.view`, trust KPI null without permission) stay gated wherever placed.
- Splits exactly: `"8/4" | "4/8" | "6/6" | "4/4/4" | "12"`; spans `8/4→[8,4]`, `4/8→[4,8]`, `6/6→[6,6]`, `4/4/4→[4,4,4]`, `12→[12]`.
- `DEFAULT_LAYOUT`: split `8/4`, band `[kpis]`, columns `[[agenda, tasks, followUps, activity], [deadlines, pulse, records]]`, hidden `[]`.
- Design tokens only (ADR-003): no new colours or fonts.
- Instants display in the viewer's zone; "today" is the viewer's calendar day (ADR-012) — reuse the `tz` the page already resolves.
- Commit with explicit pathspec: `git commit -m "…" -- <paths>`; never leave files staged; test DB up (`docker compose -f docker-compose.test.yml up -d`) before any test run.

## Review Focus

1. **Stored blob from a v2 user who hid KPIs or moved them down** — they must see the same dashboard post-ship (KPIs in column 0 at their position, not the band; hidden stays hidden). Test in Task 1.
2. **Switching split 4/4/4 → 12 → 8/4 inside one edit session** — no card may vanish or duplicate. Test in Task 1 (`setSplit` round trip) and Task 6 (component).
3. **Hidden permission-gated card restored from the tray by a viewer without the permission** — the card renders nothing in view mode and a placeholder label (not an empty box) in edit mode. Test in Task 6.
4. **Esc pressed during a keyboard drag** — cancels only the drag, not the whole edit session. Test in Task 6.
5. **Save rejected (network / auth)** — stays in edit mode with edits intact and a toast. Test in Task 6.

---

### Task 1: Layout model

**Files:**
- Modify: `src/lib/dashboard-prefs.ts` (keep `DASHBOARD_CARD_KEYS`, `DashboardCardKey`, `mergeVisibility`, `mergeOrder`, `DASHBOARD_CARD_COLUMNS` — needed for v2 conversion; delete `cardsInColumn`, `moveCardInColumn`, `mergePrefs`, `DashboardPrefs` once Task 6 removes their last callers — in this task leave them)
- Test: `src/lib/dashboard-prefs.test.ts`

**Interfaces:**
- Produces:
  - `type DashboardSplit = "8/4" | "4/8" | "6/6" | "4/4/4" | "12"`
  - `const DASHBOARD_SPLITS: readonly DashboardSplit[]` (that order)
  - `const SPLIT_SPANS: Record<DashboardSplit, number[]>`
  - `type CardPlacement = { zone: "band" } | { zone: "column"; index: number }`
  - `const DASHBOARD_CARDS: Record<DashboardCardKey, { label: string; defaultPlacement: CardPlacement }>` (labels = current `DASHBOARD_CARD_LABELS`; placements match `DEFAULT_LAYOUT`). `DASHBOARD_CARD_LABELS` becomes derived from it.
  - `type DashboardLayout = { v: 3; split: DashboardSplit; band: DashboardCardKey[]; columns: DashboardCardKey[][]; hidden: DashboardCardKey[] }`
  - `const DEFAULT_LAYOUT: DashboardLayout`
  - `type LayoutTarget = { zone: "band" } | { zone: "column"; index: number } | { zone: "hidden" }`
  - `function mergeLayout(stored: unknown): DashboardLayout`
  - `function moveCard(layout: DashboardLayout, key: DashboardCardKey, to: LayoutTarget, position?: number): DashboardLayout` — removes `key` from wherever it is, inserts at `position` in target (default: end; clamped). Column index clamped to last column.
  - `function setSplit(layout: DashboardLayout, split: DashboardSplit): DashboardLayout`
  - `function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean`

- [ ] **Step 1: Write failing tests** in `src/lib/dashboard-prefs.test.ts` (new `describe("mergeLayout")`, `describe("moveCard")`, `describe("setSplit")`; replace the v2 `"records card"` column assertion with `DASHBOARD_CARDS.records.defaultPlacement` equal `{ zone: "column", index: 1 }`):

```ts
const ALL = [...DASHBOARD_CARD_KEYS].sort();
const keysIn = (l: DashboardLayout) =>
  [...l.band, ...l.columns.flat(), ...l.hidden].sort();

test("null / garbage → DEFAULT_LAYOUT", () => {
  for (const s of [null, undefined, 42, "x", []]) expect(mergeLayout(s)).toEqual(DEFAULT_LAYOUT);
});
test("empty v2 blob converts to the default", () => {
  expect(mergeLayout({})).toEqual(DEFAULT_LAYOUT);
});
test("v2: kpis first in main → band", () => {
  const l = mergeLayout({ order: ["kpis", "tasks", "agenda", "followUps", "activity", "records", "deadlines", "pulse"] });
  expect(l.band).toEqual(["kpis"]);
  expect(l.columns).toEqual([["tasks", "agenda", "followUps", "activity"], ["records", "deadlines", "pulse"]]);
});
test("v2: kpis not first stays in column 0 at its position", () => {
  const l = mergeLayout({ order: ["agenda", "kpis", "tasks", "followUps", "activity", "deadlines", "pulse", "records"] });
  expect(l.band).toEqual([]);
  expect(l.columns[0]).toEqual(["agenda", "kpis", "tasks", "followUps", "activity"]);
});
test("v2: visible:false → hidden, removed from zones", () => {
  const l = mergeLayout({ visible: { pulse: false, kpis: false } });
  expect(l.hidden.sort()).toEqual(["kpis", "pulse"]);
  expect(l.band).toEqual([]);
  expect(l.columns[1]).toEqual(["deadlines", "records"]);
});
test("v3: duplicates — first occurrence wins band → columns → hidden", () => {
  const l = mergeLayout({ v: 3, split: "8/4", band: ["agenda"], columns: [["agenda", "tasks"], ["tasks"]], hidden: ["agenda"] });
  expect(l.band).toEqual(["agenda"]);
  expect(l.columns[0][0]).toBe("tasks");
  expect(keysIn(l)).toEqual(ALL);
});
test("v3: unknown keys and non-strings dropped; unknown split → 8/4", () => {
  const l = mergeLayout({ v: 3, split: "9/3", band: ["nope", 7], columns: "x", hidden: [] });
  expect(l.split).toBe("8/4");
  expect(keysIn(l)).toEqual(ALL);
});
test("v3: missing keys land in their default zone (column index clamped)", () => {
  const l = mergeLayout({ v: 3, split: "12", band: [], columns: [["agenda"]], hidden: [] });
  expect(l.band).toEqual(["kpis"]);
  expect(l.columns).toHaveLength(1);
  expect(l.columns[0].slice(-3)).toEqual(["deadlines", "pulse", "records"]);
});
test("v3: too many columns fold into the last; too few pad", () => {
  const l = mergeLayout({ v: 3, split: "8/4", band: [], columns: [["agenda"], ["tasks"], ["pulse"]], hidden: [] });
  expect(l.columns[1].slice(0, 2)).toEqual(["tasks", "pulse"]);
  expect(mergeLayout({ v: 3, split: "4/4/4", band: [], columns: [], hidden: [] }).columns).toHaveLength(3);
});
test("moveCard: column → band at position, hidden, and back", () => {
  let l = moveCard(DEFAULT_LAYOUT, "deadlines", { zone: "band" }, 0);
  expect(l.band).toEqual(["deadlines", "kpis"]);
  l = moveCard(l, "deadlines", { zone: "hidden" });
  expect(l.hidden).toEqual(["deadlines"]);
  l = moveCard(l, "deadlines", { zone: "column", index: 9 });
  expect(l.columns[1].at(-1)).toBe("deadlines");
  expect(DEFAULT_LAYOUT.band).toEqual(["kpis"]); // no mutation
});
test("setSplit round trip 4/4/4 → 12 → 8/4 keeps every card once", () => {
  const l = setSplit(setSplit(setSplit(DEFAULT_LAYOUT, "4/4/4"), "12"), "8/4");
  expect(keysIn(l)).toEqual(ALL);
  expect(l.columns).toHaveLength(2);
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/dashboard-prefs.test.ts` — Expected: FAIL (`mergeLayout` not exported).

- [ ] **Step 3: Implement** the Produces list in `src/lib/dashboard-prefs.ts`. `mergeLayout` follows spec §"mergeLayout" rules 1–4 in order; v2 detection = object without `v === 3`. `setSplit` = `mergeLayout({ ...layout, split })`. `layoutsEqual` = structural compare. Update the module header comment for v3.

- [ ] **Step 4: Run** the same command — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(dashboard): v3 band + columns layout model" -- src/lib/dashboard-prefs.ts src/lib/dashboard-prefs.test.ts`

### Task 2: Loader and save action

**Files:**
- Modify: `src/lib/queries/dashboard-prefs.ts`, `src/app/actions/dashboard-prefs.ts`
- Test: `src/app/actions/dashboard-prefs.test.ts`

**Interfaces:**
- Consumes: `mergeLayout`, `DashboardLayout` (Task 1)
- Produces:
  - `getDashboardLayout(userId: string): Promise<DashboardLayout>` (added beside `getDashboardPrefs`; the latter is deleted in Task 6)
  - `saveDashboardLayout(layout: unknown): Promise<DashboardLayout>` (v2 actions stay until Task 6 removes their caller)

- [ ] **Step 1: Write failing tests** — new `describe("saveDashboardLayout")` in the existing integration file, same mocks/helpers:
  - `"authenticates before validating"`: `mockedGetUser.mockRejectedValue(new Error("unauth"))`; `await expect(saveDashboardLayout("junk")).rejects.toThrow("unauth")`.
  - `"rejects non-object input"`: `for (const bad of [null, "x", 3, []]) await expect(saveDashboardLayout(bad)).rejects.toThrow()`; stored blob unchanged.
  - `"persists the sanitized layout"`: save `{ split: "6/6", band: ["bogus", "agenda"], columns: [["tasks"]], hidden: ["pulse"] }`; stored blob `toEqual` the returned value, `v === 3`, `band` `["agenda", "kpis"]`, contains no `"bogus"`, `hidden` `["pulse"]`.
  - `"revalidates the dashboard"`: `expect(mockedRevalidate).toHaveBeenCalledWith("/")`.
  - `"getDashboardLayout decodes a stored v2 blob"`: write `{ visible: { pulse: false } }` directly via prisma; `getDashboardLayout(userId)` → `hidden` `["pulse"]`.

- [ ] **Step 2: Run** `npx vitest run src/app/actions/dashboard-prefs.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both functions per spec §"Server action" (non-object = `typeof !== "object" || null || Array.isArray`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(dashboard): saveDashboardLayout action + layout loader" -- src/lib/queries/dashboard-prefs.ts src/app/actions/dashboard-prefs.ts src/app/actions/dashboard-prefs.test.ts`

### Task 3: Shared card frame

**Files:**
- Create: `src/components/dashboard/dashboard-card.tsx`, `src/components/dashboard/dashboard-card.test.tsx`

**Interfaces:**
- Produces (server-safe, no `"use client"`):
  - `DashboardCard(props: { title: string; count?: number; warn?: string; viewAllHref?: string; empty?: { icon: LucideIcon; text: string } | null; children?: ReactNode })` — renders `empty` state instead of children when `empty` is non-null. Wrapper has `@container` and `data-slot="dashboard-card"`.
  - `DashboardRow(props: { href?: string; children: ReactNode })` — the one list-row style (Link when `href`, div otherwise): `flex items-center gap-3 py-2 border-b border-line last:border-b-0`, hover `bg-paper-2` only for links.
  - `LatePill(props: { children: ReactNode; tone: "warn" | "brand" | "muted" })` — the one pill treatment (`warn` = `bg-warn-soft text-warn border-warn-border`, as today).

- [ ] **Step 1: Write failing tests**: count renders next to title; `warn="3 overdue"` renders that text; `viewAllHref="/calendar?show=deadlines"` renders a link named `/view all/i` with that href, absent when omitted; `empty={{ icon: Inbox, text: "Nothing here" }}` shows the text and not the children; `DashboardRow` with `href` is a link, without is not.
- [ ] **Step 2: Run** `npx vitest run src/components/dashboard/dashboard-card.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Title uses the display font (`font-display`), per spec §"Visual refresh".
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(dashboard): shared DashboardCard frame, row and pill" -- src/components/dashboard/dashboard-card.tsx src/components/dashboard/dashboard-card.test.tsx`

### Task 4: One file per card, on the shared frame

**Files:**
- Create: `src/components/dashboard/cards/{kpis,agenda,tasks,follow-ups,activity,deadlines,pulse,records}.tsx`
- Modify: `src/app/(dashboard)/page.tsx` (card JSX → card components; `TaskGroup`, `FollowUpRow`, `formatTaskDue`, `formatMoney` move into the card files that use them)
- Test: `src/components/dashboard/cards/cards.test.tsx`

**Interfaces:**
- Consumes: Task 3 components; existing query types from `@/lib/queries/dashboard` and `getMyRecordsToChase`'s return type.
- Produces: each card a server component taking its loaded data: `KpisCard({ kpis })`, `AgendaCard({ items })`, `TasksCard({ tasks })`, `FollowUpsCard({ items })`, `ActivityCard({ items, canViewActivityLog })`, `DeadlinesCard({ data })`, `PulseCard({ pulse })` (returns null when `pulse` null), `RecordsCard({ items })`.

- [ ] **Step 1: Write failing tests** (render each card with fixture data):
  - `KpisCard`: tile grid has classes `@2xl:grid-cols-4` and `@sm:grid-cols-2`; "Hours today" tile renders a `role="progressbar"` with `aria-valuenow` = `round(hoursToday/hoursGoal*100)` capped at 100; trust tile absent when `trustBalance === null`.
  - View-all hrefs: Agenda `/calendar?view=day`; Deadlines `/calendar?show=deadlines`; FollowUps `/communication`; Activity `/settings/activity` only when `canViewActivityLog`; Tasks and Records have no "View all" link.
  - Late treatment: a deadline with `days: -2` and a task with `daysUntilDue: -1` both render their late label inside an element with class `text-warn`.
  - `PulseCard({ pulse: null })` renders nothing.
- [ ] **Step 2: Run** `npx vitest run src/components/dashboard/cards` — FAIL.
- [ ] **Step 3: Implement** — move markup out of `page.tsx` onto `DashboardCard` / `DashboardRow` / `LatePill`; empty states become `empty={{ icon, text }}` keeping today's text. Page still renders the v2 two-column layout using `getDashboardPrefs` (layout swap is Task 6) and resolves `canViewActivityLog` via `currentUserHasPermission("firm.view_activity")` only when activity is visible.
- [ ] **Step 4: Run** the card tests plus `npx vitest run src/lib/queries/dashboard src/lib/queries/matter-access-dashboard.test.ts` — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "refactor(dashboard): one component per card on the shared frame" -- src/components/dashboard/cards "src/app/(dashboard)/page.tsx"`

### Task 5: Data loading by layout + greeting line

**Files:**
- Create: `src/lib/queries/dashboard-data.ts`, `src/lib/queries/dashboard-data.test.ts`, `src/components/dashboard/greeting.tsx`
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `DashboardLayout` (Task 1); existing loaders.
- Produces:
  - `loadDashboardData(layout: DashboardLayout, tz: string): Promise<DashboardData>` — moves the page's `Promise.all` block; loader skipped (empty value) for any key in `layout.hidden`; `records` also needs `records.view`, `activity`'s `canViewActivityLog` needs `firm.view_activity`. `DashboardData` = `{ kpis, agenda, activity, canViewActivityLog, deadlines, pulse, tasks, followUps, records, canViewRecords }` with today's types.
  - `dueTodayCount(data: DashboardData, layout: DashboardLayout): number | null` — `tasks.today.length` + deadlines with `days === 0`; `null` when both `tasks` and `deadlines` are hidden.
  - `Greeting({ tz, dueToday }: { tz: string; dueToday: number | null })` — e.g. "Tuesday, October 20 · 3 due today" (date via `Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" })`); omits the count part when `null`.

- [ ] **Step 1: Write failing tests** (mock `@/lib/queries/dashboard`, `@/lib/queries/records-requests`, `@/lib/permission-check` with `vi.mock`):
  - `"skips loaders for hidden cards"`: layout with `hidden: ["pulse", "tasks"]` → `getFirmPulse` and `getMyOpenTasks` not called; others called once with `tz`.
  - `"records needs records.view"`: permission false → `getMyRecordsToChase` not called, `canViewRecords` false.
  - `dueTodayCount`: 2 today tasks + deadlines `[0, 0, 3]` → 4; both hidden → `null`.
- [ ] **Step 2: Run** `npx vitest run src/lib/queries/dashboard-data.test.ts` — FAIL.
- [ ] **Step 3: Implement**; page calls `getDashboardLayout` + `loadDashboardData` and renders `<Greeting>` above the grid. The page still renders two columns in this task by mapping `layout.band` + `layout.columns` with the 8/4 spans (static, no customizer yet) — this is the v3 read path going live with no editor.
- [ ] **Step 4: Run** the new test + Task 4 card tests — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(dashboard): layout-driven data loading and greeting line" -- src/lib/queries/dashboard-data.ts src/lib/queries/dashboard-data.test.ts src/components/dashboard/greeting.tsx "src/app/(dashboard)/page.tsx"`

### Task 6: Customize mode

**Files:**
- Create: `src/components/dashboard/customizer.tsx` (`"use client"`), `src/components/dashboard/customizer.test.tsx`, `src/components/dashboard/split-picker.tsx`
- Modify: `src/app/(dashboard)/page.tsx`, `package.json` / lockfile, `src/lib/dashboard-prefs.ts` (delete `cardsInColumn`, `moveCardInColumn`, `mergePrefs`, `DashboardPrefs`), `src/lib/queries/dashboard-prefs.ts` (delete `getDashboardPrefs`), `src/app/actions/dashboard-prefs.ts` + its test (delete v2 actions and their tests)
- Delete: `src/components/dashboard/customize-button.tsx`, `customize-button.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 5.
- Produces:
  - `DashboardCustomizer({ initialLayout, cards }: { initialLayout: DashboardLayout; cards: Partial<Record<DashboardCardKey, ReactNode>> })` — `cards` holds only cards that render something for this viewer (page omits null ones). Renders view mode (band + `grid grid-cols-12` with `lg:col-span-{n}` per `SPLIT_SPANS`, stacked below lg, empty zones omitted) and owns edit state. Its "Customize" trigger is rendered in the page body header row next to `<Greeting>` (not the TopBar, which is a server component prop slot — keeps state in one client tree).
  - `applyDragEnd(layout: DashboardLayout, activeKey: DashboardCardKey, over: { zone: "band" | number; index: number } | null): DashboardLayout` — exported pure helper wrapping `moveCard`; `null` over → unchanged.

Install: `npm install @dnd-kit/core@6 @dnd-kit/sortable@10 @dnd-kit/utilities@3`.

Behaviour (spec §"Customize mode"): toolbar = `SplitPicker` (radiogroup, one radio per split, accessible name e.g. "8 / 4"), "Hidden (n)" tray (chip per hidden card → `moveCard(…, { zone: "column", index: 0 })`), "Reset to default" (→ `DEFAULT_LAYOUT`), Cancel, Done. Edit strip per card: handle (`aria-label="Drag {label}"`), label, hide button (`aria-label="Hide {label}"`). Card body `inert`, `max-h-48 overflow-hidden opacity-60`. A placed card missing from `cards` (no permission) shows its label + "Not available for your role" in edit mode, nothing in view mode. Below lg (`lg:hidden`) a list editor replaces drag: per card "Move {label} up/down" buttons, a `select` labelled "Zone for {label}", and hide. Done → if `layoutsEqual` → exit; else `saveDashboardLayout(layout)` → `router.refresh()` → exit; on throw → `toast.error("Couldn't save your dashboard layout")`, stay in edit mode. Esc (window keydown) cancels the session only when no drag is active (track `activeId` from `onDragStart`/`onDragEnd`/`onDragCancel`).

- [ ] **Step 1: Write failing tests** (mock `@/app/actions/dashboard-prefs`, `next/navigation` `useRouter`, `sonner`; drive via the list-editor buttons, which jsdom can operate — dnd-kit pointer/keyboard sensors need layout geometry jsdom lacks, so drag is covered through `applyDragEnd` plus manual QA):
  - `applyDragEnd`: deadlines over `{ zone: "band", index: 0 }` → band `["deadlines","kpis"]`; over `null` → same object contents.
  - `"view mode renders band then columns with spans"`: 8/4 → two column containers with `lg:col-span-8` and `lg:col-span-4`.
  - `"hide then restore from tray"`: Customize → Hide Firm pulse → tray shows "Hidden (1)" → click chip → pulse back as the last card of the first column.
  - `"split change keeps every card"`: choose "4 / 4 / 4", then "12", then "8 / 4" → all 8 labels present once.
  - `"Cancel restores the original"`: move a card, Cancel → original order, `saveDashboardLayout` not called.
  - `"Done with no changes makes no call"`.
  - `"Done saves once and refreshes"`: after one move → `saveDashboardLayout` called once with the edited layout; `router.refresh` called; edit toolbar gone.
  - `"failed save keeps edits"`: save rejects → `toast.error` called, toolbar still present, moved card still moved.
  - `"Esc exits edit mode only when no drag is active"`: the customizer root carries `data-dragging="true"` while a drag is active (set in `onDragStart`, cleared in `onDragEnd`/`onDragCancel`) and the window Esc handler reads that attribute. Test: Esc with no drag → toolbar gone, no save; set `data-dragging="true"` on the root, Esc → toolbar still present.
  - `"unpermitted card"`: `cards` without `pulse`, layout containing pulse → view mode has no "Firm pulse"; edit mode shows "Not available for your role".
- [ ] **Step 2: Run** `npx vitest run src/components/dashboard/customizer.test.tsx` — FAIL.
- [ ] **Step 3: Implement**; page passes `initialLayout` + `cards` (built from `loadDashboardData` output; omit keys whose component would render null) to `DashboardCustomizer`; remove the TopBar `actions` customize button and delete v2 code listed above.
- [ ] **Step 4: Run** `npx vitest run src/components/dashboard src/lib/dashboard-prefs.test.ts src/app/actions/dashboard-prefs.test.ts src/lib/queries` — PASS; `npx tsc --noEmit` and `npm run lint` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(dashboard): in-place customize mode with drag, splits and hidden tray" -- package.json package-lock.json src/components/dashboard "src/app/(dashboard)/page.tsx" src/lib/dashboard-prefs.ts src/lib/dashboard-prefs.test.ts src/lib/queries/dashboard-prefs.ts src/app/actions/dashboard-prefs.ts src/app/actions/dashboard-prefs.test.ts`

### Task 7: Verify in the app, docs, cleanup

**Files:**
- Modify: `docs/features/app-shell.md`, `docs/ROADMAP.md`, `docs/UI_PATTERNS.md`
- Delete: this plan and the spec

- [ ] **Step 1: Manual QA** with the `run` skill: as a user with a stored v2 blob (`{ visible: { pulse: false }, order: [...] }`), dashboard matches the pre-change layout; drag by mouse and by keyboard (Space/arrows/Space, Esc mid-drag) across band and columns in all five splits; hide/restore; Reset; Cancel; Done persists across reload; < lg list editor works; a user without `reports.view` sees no pulse anywhere.
- [ ] **Step 2: Full suite** `npm test` — all pass.
- [ ] **Step 3: Docs** — app-shell.md: replace the v3 open item with a shipped entry (band + columns, splits, in-place customize, v2 conversion on read) and add open items for sub-project 2 (triage + new cards) and 3 (role defaults); fold the v1/v2 shipped bullets into it. ROADMAP line 74 → sub-projects 2 and 3. UI_PATTERNS.md: `DashboardCard`/`DashboardRow`/`LatePill` and "cards size by container query, not viewport".
- [ ] **Step 4: Commit** `git commit -m "docs(dashboard): v3 layout shipped; triage cards and role defaults next" -- docs/features/app-shell.md docs/ROADMAP.md docs/UI_PATTERNS.md docs/superpowers/specs/2026-10-20-dashboard-v3-layout-design.md docs/superpowers/plans/2026-10-20-dashboard-v3-layout.md` (the two deleted files via `git rm` first, then the pathspec commit).
