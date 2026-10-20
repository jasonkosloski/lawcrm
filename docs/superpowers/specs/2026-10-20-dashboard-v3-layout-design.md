# Dashboard v3 — layout engine + visual refresh (sub-project 1 of 3)

Tier: Full (more than a day of work; touches a persisted per-user blob).

## Context

The dashboard (`src/app/(dashboard)/page.tsx`) renders 8 cards — `kpis`,
`agenda`, `tasks`, `followUps`, `activity`, `deadlines`, `pulse`,
`records` — in two fixed columns (main + 340px rail). v1 added show/hide,
v2 added up/down reorder within a card's fixed column, both persisted in
`User.dashboardPrefs` as `{ visible, order }` (`src/lib/dashboard-prefs.ts`).

The "Dashboard v2" effort is split into three sub-projects, each with its
own spec → plan → build:

1. **Layout engine + visual refresh** (this spec)
2. "Needs me now" triage card + new cards (pinned matters, time-this-week
   chart, new leads, unbilled time, upcoming SOLs) — permission/money work
3. Role default layouts (`Role.dashboardLayout`, Settings → Roles editor,
   reset-to-role-default) — the only schema change, done last so the
   layout shape is settled

## Goals

- Drag any card anywhere: a full-width **band** on top plus 1–3 **columns**.
- Choose the column split: `8/4`, `4/8`, `6/6`, `4/4/4`, `12`.
- Customize in place on the real dashboard, with Cancel / Done.
- Cards adapt to the width they're placed in.
- One shared card frame and a consistent, quieter visual language.
- A v2 user's dashboard looks the same the day this ships, before they
  customize.

## Non-goals

- New cards, triage card, charts (sub-project 2).
- Role defaults (sub-project 3). "Reset" uses the built-in default here.
- Free 2D placement or height resizing (rejected: fixed row heights clip
  lists; gaps or post-load layout shift).
- Any query, permission, or scope change.

## Data model

Stored in the existing `User.dashboardPrefs` JSON column — no migration.

```ts
type DashboardSplit = "8/4" | "4/8" | "6/6" | "4/4/4" | "12";

type DashboardLayout = {
  v: 3;
  split: DashboardSplit;
  band: DashboardCardKey[];      // full-width, rendered first
  columns: DashboardCardKey[][]; // length === column count of `split`
  hidden: DashboardCardKey[];
};
```

`SPLIT_SPANS: Record<DashboardSplit, number[]>` gives each column's span
out of 12 (`"8/4" → [8, 4]`, `"12" → [12]`).

`DEFAULT_LAYOUT` (what a new user and "Reset" get) reproduces today's page:
split `8/4`, band `[kpis]`, columns
`[[agenda, tasks, followUps, activity], [deadlines, pulse, records]]`,
hidden `[]`.

Each card registers a **default placement** (`{ zone: "band" } |
{ zone: "column", index }`) used when a card is missing from a stored
layout.

### `mergeLayout(stored: unknown): DashboardLayout`

Pure, Prisma-free, safe on the client. Rules, in order:

1. **Non-object** → `DEFAULT_LAYOUT`.
2. **v2 blob** (no `v: 3`; has `visible` and/or `order`) → convert:
   - order = `mergeOrder(stored)`, visibility = `mergeVisibility(stored)`
   - if `kpis` is first among main-column cards in that order → band
     `[kpis]`; otherwise kpis stays in column 0 at its position
   - other main cards → column 0, rail cards → column 1, in order
   - cards with `visible === false` → `hidden` (removed from zones)
   - split `8/4`
3. **v3 blob** → sanitize:
   - unknown `split` → `8/4`
   - drop non-string / unknown keys everywhere; first occurrence wins
     across band → columns (left to right) → hidden, so each key appears
     exactly once
   - `columns` not an array → `[]`; non-array entries → `[]`
   - more columns than the split allows → extra columns are appended to
     the last allowed column; fewer → padded with `[]`
4. **Missing known keys** (cards added after the user saved) → inserted
   at the end of their default placement zone (column index clamped to
   the last column).

Also pure helpers, shared by drag and the mobile list:

- `moveCard(layout, key, to: { zone: "band" | number | "hidden", index })`
  → new layout (no mutation).
- `setSplit(layout, split)` → re-folds columns via rule 3.

The v1/v2 helpers (`mergeVisibility`, `mergeOrder`, `cardsInColumn`,
`moveCardInColumn`, `DASHBOARD_CARD_COLUMNS`) are kept only as far as the
v2 conversion needs them; unused exports are deleted.

## Server action

`src/app/actions/dashboard-prefs.ts` keeps one action:

```ts
saveDashboardLayout(layout: unknown): Promise<DashboardLayout>
```

1. `getCurrentUserId()` first (auth error before validation).
2. Reject non-object input.
3. `next = mergeLayout({ ...layout, v: 3 })`; write `next` wholesale.
4. `revalidatePath("/")`; return `next`.

No permission key: the dashboard layout is the viewer's own preference
(same as v1/v2). `setDashboardCardVisible` and `setDashboardCardOrder`
are removed — their only caller is the popover being replaced.
`getDashboardPrefs` becomes `getDashboardLayout` returning
`mergeLayout(user.dashboardPrefs)`.

## Page rendering

`page.tsx` keeps: auth, timezone, the post-response sweep, data loaders,
and layout rendering. Loaders for cards in `hidden` are skipped (as today
with `visible`). Permission-gated cards (`pulse`, `records`, the trust
KPI) still render nothing without permission, wherever they're placed.

Layout:

- **lg+**: band (stacked full width), then a `grid grid-cols-12 gap-5`
  with one column per split entry spanning `SPLIT_SPANS[split][i]`; each
  column is a vertical stack of its cards.
- **< lg**: band, then column 0, column 1, … stacked in a single column.
- Each card wrapper is a CSS container (`@container`, Tailwind v4); card
  internals use container breakpoints, not viewport ones. KPI tiles:
  4 across ≥ `@2xl`, 2 ≥ `@sm`, else 1.
- An empty column renders nothing outside customize mode.

### Card registry and file split

Cards move out of the 650-line page into
`src/components/dashboard/cards/<key>.tsx` — server components that take
their already-loaded data as props. The card registry
(`DASHBOARD_CARDS: Record<DashboardCardKey, { label, defaultPlacement }>`)
lives in `src/lib/dashboard-prefs.ts` beside the keys — `mergeLayout`
needs the placements, and that module is already Prisma- and
component-free so the client editor can import it. The page holds the
key → element map. Sub-project 2 adds cards by registering there.

## Customize mode

Client component `DashboardCustomizer` wraps the layout. A "Customize"
button in the page header row (beside the greeting, inside the
customizer's client tree so edit state lives in one place) toggles it;
the v2 topbar popover is removed.

**Edit mode (lg+):**

- Sticky toolbar under the topbar: split picker (segmented control with
  mini diagrams of each split), "Hidden (n)" tray (click a chip →
  card restored to the end of column 0), "Reset to default", Cancel,
  Done.
- Each card shows an edit strip (drag handle ⠿, label, eye-off hide
  button) over its real content; the body is dimmed, `inert`, and capped
  at a fixed preview height so dragging doesn't reflow wildly.
- Band and each column are drop zones with a dashed outline; empty zones
  show "Drop a card here".
- Drag via `@dnd-kit/core` + `@dnd-kit/sortable` (new dependency):
  pointer, touch, and keyboard sensors (Space to lift, arrows to move,
  Space to drop, Esc to cancel the drag), with screen-reader
  announcements naming the card and target zone.

**Edit mode (< lg):** a list editor instead of drag — one row per card
with up/down buttons, a zone select (Band / Column 1…n), and hide.

**Persistence:** edits are local state. Done → one
`saveDashboardLayout` call → `router.refresh()` and exit edit mode.
Cancel (or Esc when not dragging) discards. On save failure: stay in
edit mode, keep the edits, toast the error (sonner). Done with no
changes exits without a call.

Card content is server-rendered; the customizer receives the rendered
card nodes keyed by card key and only rearranges them, so no data
fetching moves to the client.

## Visual refresh

All within existing design tokens (ADR-003); no new colours or fonts.

- **`DashboardCard`** (`src/components/dashboard/dashboard-card.tsx`):
  title (display font), optional count, optional warn pill, optional
  "View all →" link, body, and a shared empty state (icon + one line).
  Every card uses it.
- **"View all" targets** (only where a page exists and the viewer can
  open it): agenda → `/calendar?view=day`, deadlines →
  `/calendar?show=deadlines`, follow-ups → `/communication`, activity →
  `/settings/activity` only with `firm.view_activity`. Tasks and records
  have no list page — no link.
- **One list-row style** (padding, separator, hover) shared by agenda,
  tasks, follow-ups, deadlines, records.
- **One overdue/late treatment** (warn token pill/text) used identically
  across tasks, deadlines, follow-ups, records.
- **KPI tiles** keep their gradients; "Hours today" gains a thin progress
  bar against the daily goal.
- **Greeting line** above the grid: viewer's weekday + date in their
  timezone and "N due today" (tasks due today + deadlines due today),
  computed from data already loaded; omitted when both cards are hidden.

## Testing

- `src/lib/dashboard-prefs.test.ts` — `mergeLayout`: null/garbage;
  v2 → v3 (kpis first, kpis not first, hidden cards, empty v2 blob);
  dupes across zones; unknown keys; missing cards → default zone; split
  shrink folds columns, split grow pads; `moveCard` to band / column /
  hidden; `setSplit`.
- `src/app/actions/dashboard-prefs.test.ts` — auth before validation;
  non-object rejected; persisted value is the sanitized layout;
  revalidates `/`.
- `DashboardCustomizer` component test — keyboard drag between columns;
  hide + restore from tray; Cancel restores original; Done calls save
  once; Done with no changes calls nothing; failed save stays in edit
  mode with edits.
- `DashboardCard` test — empty state, count, warn pill, link presence.
- Page: a hidden card's loader is skipped under the v3 shape; existing
  `dashboard-privacy` and `matter-access-dashboard` tests pass unchanged.
- Manual: all five splits by drag, mobile list editor, a seeded v2 prefs
  user renders identically before customizing.

## Docs

On ship: `docs/features/app-shell.md` (v3 shipped; follow-ups for
sub-projects 2 and 3), its ROADMAP line, `docs/UI_PATTERNS.md`
(`DashboardCard` + container-query cards). Delete this spec and its plan.
