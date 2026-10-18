# UI Patterns & Component Conventions

Reusable patterns extracted from the design handoff and applied consistently across the app. Reference this when building new screens.

---

## Brand Identity

The visual identity is **warm paper + saturated navy blue**. This is not a generic SaaS gray app.

- Canvas: `#faf9f5` (warm paper)
- Cards: `#ffffff` with `1px solid #e5e4de` border
- Email reader: `#faf8f3` (slightly warmer than canvas — document feel)
- Primary: `#2563a8` (brand blue)
- All active/selected states, focus rings, primary buttons use the brand blue

**Do not drift toward cold grays or generic Tailwind slate palette.**

---

## Typography

| Usage | Font | Size | Weight | Extra |
|---|---|---|---|---|
| UI body text | Inter | 12.5px–13px | 400 | `line-height: 1.4–1.55` |
| Section labels | Inter | 10px | 600 | `uppercase`, `tracking-[0.08em]`, `text-ink-4` |
| Nav items | Inter | 12.5px | 400 (500 active) | |
| Badges/counts | JetBrains Mono | 10px | 500 | |
| Timestamps/meta | JetBrains Mono | 10–11px | 400 | `text-ink-3` or `text-ink-4` |
| Page titles | Fraunces | 20–26px | 500 | `tracking-tight`, color `#0f1b2e` |
| Email subjects | Fraunces | 22px | 500 | `letter-spacing: -0.01em` |
| Email body | Fraunces | 13.5px | 400 | `line-height: 1.62`, `white-space: pre-wrap` |
| Chips/pills | Inter | 10–11px | 500–600 | |

**Rule:** Fraunces is for display and email bodies only. All UI chrome is Inter.

---

## Component Patterns

### KPI Tile
```
Card with gradient overlay (kpi-accent class) + absolute-positioned icon badge (top-right).
- Label: 10px uppercase tracking, text-ink-3
- Value: 24px font-display (Fraunces)
- Subtitle: 11px text-ink-4
- Variants: accent (blue), critical (warm), ok (green)
```

### Status Chip
```
Pill-shaped: 10–11px, font-medium, border-radius: 999px
- Filled: bg-brand-500, white text (active stages)
- Accent: bg-brand-soft, text-brand-700, border-brand-200 (default matter chips)
- Ok: bg-[#ecf6f1], text-ok, border-[#a4d4bc] (filed, completed)
- Warn: bg-[#fbf0ea], text-warn, border-[#e2c0ad] (unfiled, overdue)
- Ghost: dashed border, transparent bg, text-ink-3 (unfiled pill)
```

### Empty State
```
Shared component: src/components/shared/empty-state.tsx
- Icon (lucide, 18px, text-ink-4, aria-hidden) above a text-sm
  font-semibold title, optional text-xs text-ink-3 description
  (max-w-sm), optional CTA children slot.
- Wrapping is the caller's job — drop inside a Card, a table
  cell (colSpan + p-0), or a list <li>. Pass `framed` for the
  standalone dashed-border card look (search page style).
- Don't hand-roll new empty states; extend this one.
- Count labels near lists use plural(n, "matter") from
  src/lib/utils.ts — never hardcode "N matters".
```

### Nav Item (Sidebar)
```
Active: bg-brand-500, text-white, inner highlight shadow
Hover (inactive): bg-[#eaf0f5], text-brand-700
Badge: mono 10px, bg-brand-50, text-brand-700, border-brand-100
Badge (active): bg-white/18%, text-white
```

### Card Hover
```
Transition: box-shadow 0.16s, border-color 0.16s
Hover: border-brand-300, shadow with blue tint
Class: card-hover
```

### Table
```
- Header: bg-[#edf1f3], text-brand-700, 10px uppercase tracking
- Row hover: bg-brand-tint (#f6faff)
- Clickable rows: cursor-pointer
- Cell padding: 8px 10px
- Border: 1px solid line between rows
```

### Button Hierarchy
```
Primary: bg-brand-500, text-white, blue shadow (main actions)
Secondary: bg-white, border-line, text-ink (supporting actions)
Ghost: transparent bg, text-ink-2 (tertiary/icon buttons)
Small: padding 3px 7px, text 11px

Hover (non-primary): border-brand-300, text-brand-700
Active: translateY(0.5px)
```

---

## Layout Patterns

### Two-Column Dashboard
```
Left: flex-1 (main content — KPIs, lists, feeds)
Right: w-[340px] shrink-0 (sidebar widgets — deadlines, pulse)
Gap: 20px
```

### Split Pane (Intake, Email)
```
Left rail: fixed width (200–360px), scrollable list
Right: flex-1, detail view
Divider: 1px border or visual gap
```

### Three-Pane (Email)
```
Mailboxes: 200px, #fbfafa bg
Thread list: 360px, white bg
Reader: flex-1, #faf8f3 bg (paper tone)
Details drawer: 280px, toggled
```

### Matter Detail Tabs
```
Horizontal tab row under topbar
Active: text-brand-900, border-bottom brand-500
Inactive: text-ink-3
Tab content fills remaining height with overflow-y-auto
```

Implementation: `src/components/matters/matter-tabs.tsx` — client component
reading `usePathname()` to pick the active tab. The tab list is the `TABS`
constant in that file (Overview, Timeline, Events, Communication, Documents,
Evidence, Parties, Deadlines, Tasks, Notes, Time & expenses, Billing). Overview
is the base route (`/matters/[id]`); other tabs are nested routes. The tab bar
has no contextual Add button; creation lives in the header Create menu and each
tab's own composer. Loading skeletons nested under a layout that renders its own
header use `<PageSkeleton withTopBar={false} />`.

### Matter or intake scope (`RecordScope`)

The note, task and event composers and the notes list take a `scope`
(`src/lib/record-scope.ts`) — `{ kind: "matter", matterId }` or
`{ kind: "lead", leadId }` — instead of a bare `matterId`. The scope picks
the server action (`createNote` / `createLeadNote`, `createTaskWithCaptures`
/ `createLeadTask`, `createEventWithCaptures` / `createLeadEvent`), and on a
lead the matter-only affordances are hidden: sibling captures (pages pass
`siblingKinds={[]}` / `allowedKinds={[]}`), attached tasks / deadlines /
time, Convert to task / deadline, log time and add note on a task. The
status-grouped task list is `TaskListByStatus`
(`src/components/tasks/task-list-by-status.tsx`), shared by the matter and
intake Tasks tabs (`matterId={null}` on a lead). Intake tabs (Overview,
Notes, Tasks, Events, Communication, Time & expenses) live in
`src/components/intake/intake-tabs.tsx`; a converted lead's tabs show a
banner linking to the matter instead of a composer.

### In-Tab Channel Toggle (Communication tabs)
```
Segmented control, same visual idiom as the matters Table/Kanban toggle
Active: bg-brand-soft text-brand-700 · Inactive: text-ink-3
URL-driven: ?channel=email|phone (default channel omits the param)
Plain <Link>s, not router.replace — switching channel drops ?thread=,
which is per-channel state
```

Implementation: `src/components/communication/channel-toggle.tsx`. Used on
the matter-detail Communication tab to switch between the embedded email
inbox and the matter Phone log (`matter-phone-log.tsx`). Action affordances
(e.g. the "Log call" button) sit to the right of the toggle on the same row.

### Permission-aware composer controls (`NoteComposer` `canPin`)

Composer controls that map to a gated capability take an explicit
boolean prop computed server-side with `currentUserHasPermission` and
default it to `false` so the control fails closed (`<NoteComposer canPin />`
shows the Pin toggle; omitted hides it and never submits `isPinned`).
The prop is cosmetic: the server action re-checks (`notes.pin`) on every
call. Pages rendering the composer must pass the flag.

### Sortable Column Header

Three-state click cycle: asc → desc → clear (see ADR-009).

```
Inactive: neutral "up/down" icon (low opacity), text-ink-2
Active asc: up arrow, text-brand-700
Active desc: down arrow, text-brand-700
```

URL contract: `?sort=<field>&dir=asc|desc`. Absent means default ordering.
Use `useTransition` for the router update so the table dims slightly while
re-rendering. See `src/components/matters/sortable-header.tsx`.

URL-state controls (sort, filters, view toggles) write query params through
`useUrlParams` (`src/hooks/use-url-params.ts`) so rapid successive changes
compose instead of overwriting each other.

### Filter Popover (Linear-style)

Each filter is a button that opens a popover. Active filter shows a blue
chip on the button with optional count. Changes apply immediately — no
Apply button; popover closes on outside click.

```
Inactive button: variant="outline", size="xs", text-ink-2
Active button: bg-brand-soft, text-brand-700, border-brand-200
Active count: " · N" suffix in font-mono
Popover: 14–16rem wide, checkboxes (multi-select) or radio-like rows
         (single-select). Clear link at top when any value is selected.
```

URL contract: multi-select uses repeated params (`?area=§1983&area=Housing/FHA`);
single-select uses a single param with defaults omitted. Parse/serialize
centralised in `src/lib/matters-filters.ts`.

### Command Palette

Global ⌘K/Ctrl+K palette built on `cmdk` via shadcn's `Command` primitives.
Opens from anywhere; also triggered by the sidebar and topbar ⌘K buttons.

**Architecture:**
- `CommandPaletteProvider` (client) owns the open state and registers the
  global keyboard shortcut. Mounted inside `AppShell` so every
  authenticated page is within its scope.
- `useCommandPalette()` hook exposes `open`, `openPalette`,
  `closePalette`, `togglePalette`. Any client component can trigger the
  palette via this.
- Data fetched per-open via the `getPaletteData` server action
  (`src/lib/queries/command-palette.ts`). Small cost; cmdk filters in
  memory.

**Sections (order matters — shown top-down):**
1. Contextual (e.g. Pin/Unpin this matter, only when on a matter page)
2. Recent (from localStorage, when no query)
3. Pinned matters (when no query)
4. Navigation (always listed, cmdk filters to matches)
5. Matters / People / Leads (filtered to matches)

**Adding a new searchable entity:**
1. Add to the `PaletteItem` union in `src/lib/queries/command-palette.ts`
2. Include it in the `getPaletteData` fetch
3. Add a `CommandGroup` for it in the palette component

**Adding a new navigation destination:**
Append to `NAV_DESTINATIONS` in `src/lib/command-palette/destinations.ts`.
No UI changes needed.

**Adding a contextual action:**
Extend the contextual section in `command-palette.tsx` gated on the
appropriate route check (`pathname.startsWith(...)`) or page-provided
context.

### Layout-Persistent Panel Stack (provider-owned)

Pattern used by the matter-detail header **Create** menu and the
**calendar** New event flow. Only "Add note" (matter) and "New event"
(calendar) open real composers in the dock; the other matter Create
entries navigate to their matter tab, where the working composer lives
(`MATTER_CREATE_TAB` in `matter-create-menu.tsx`). The menu still lists all
entry types regardless of the viewer's create permissions (`allowedTypes`
exists but the layout does not pass it yet); each destination gates its own
composer.
Multiple concurrent panels are supported — common use case: taking
notes during a hearing while adding a newly-announced court date,
without losing either in progress.

**Architecture:**

1. `CreateStackProvider` (client) is mounted inside a layout that
   should host the stack — `matters/[id]/layout.tsx` for the matter
   detail surface, directly on `calendar/page.tsx` for the calendar.
   It holds `panels: CreatePanel[]` + `focusedId` in React state.
   Next.js layouts don't remount on child route changes, so the
   provider — and everything in it — survives navigation within
   its subtree.
2. `useCreateStack()` exposes `open(type)`, `close(id)`, `focus(id)`,
   and `setExpanded(id, bool)`.
   Triggers (header Create dropdown, empty-state CTA, "+ New event" on
   calendar) call `open(type)` —
   URL params are not involved.
3. The provider takes an optional `context` prop (color + label +
   sublabel) that drives the expanded-mode context strip inside the
   modal. Matter detail passes the matter's color/name/case number;
   calendar passes nothing (no per-matter context since an event
   might be firm-wide). This is how one generic stack serves both
   contexts.
4. `CreateDock` (`src/components/create-stack/create-dock.tsx`) renders the current focused panel (docked
   right-rail or expanded modal). Non-focused open panels render as
   compact chips **inside the focused panel's chrome, right below
   its header** (under an "Also open" label). Keeping chips adjacent
   to the active panel — instead of floating in the viewport corner
   — means they're always in the user's line of sight and never
   overlap the active panel's own controls. The "Also open" strip
   only renders when there are 2+ open panels; a single panel keeps
   the chrome quiet.
5. **Every open panel's body stays mounted.** `CreateDock` renders
   one `PanelBody` per open panel, keyed by panel id, inside a single
   persistent shell; only the focused body is visible (the others
   are `hidden`). Each body's own React state IS its draft, so it
   survives expand/collapse and focus switches, and no two panels
   ever share one form instance. The provider holds only panel
   metadata (id, type, expanded) and the focus pointer, never form
   values. Don't move a body into a conditional JSX branch or key it
   by anything but panel id — that remounts it and drops the draft.

**Focus semantics:**

- Opening a new panel minimizes the currently focused one to a chip
  and makes the new one focused.
- Clicking a chip focuses that panel; **expansion is preserved
  across the switch** — if the user was in expanded-modal focus
  mode, the newly-focused panel opens in modal too. Dumping the user
  back to the docked rail just because they switched drafts would
  break the focus session.
- Closing the focused panel shifts focus to the most recently
  opened remaining panel, or to nothing if the stack is empty.
  Same expansion-preservation rule applies: if the closed panel was
  expanded, the next focused panel inherits the expansion.
- `Escape` is handled on the panel itself, not on `window`. It collapses
  expanded → docked. Docked, it closes the panel only when nothing has been
  typed in it (a DOM check of textarea/input/contenteditable); the X button is
  the explicit discard. The expanded modal is a real dialog (role, aria-modal,
  Tab trap).

**The panel is single-type by design:** clicking "Add note" means
the user intends to create a note — letting them flip mid-edit to
a time entry is confusing and risks losing content. The entry point
determines the type; to switch, close the panel and open the new
type (the original stays in its current state as a chip).

**When to reach for this pattern:** any "do something without losing
context" flow where multiple simultaneous drafts are plausible.
Contrast with a modal dialog (blocks interaction, one at a time) or
a full-page route (loses context entirely).

**Deferred:** deep-linking to a specific panel state via URL.
Previous iteration used `?create=<type>` but the multi-panel model
doesn't serialize cleanly into query params. If sharing a "start me
in this create state" link becomes important, add it back as a
seed-on-mount behavior.

### Settings Section Layout

`/settings/*` uses a left-rail layout (not a top tab bar — too many
sections to fit horizontally). Sections are grouped by scope:

- **Account** — things that belong to the current user (Profile, Security, Notifications)
- **Firm** — things that belong to the whole firm (Team, Firm info, Integrations, Billing & rates)

Each section is its own route under `/settings/<slug>`. Adding a new
settings area is two steps: add it to `SECTIONS` in
`src/components/settings/settings-nav.tsx`, and create the page under
`src/app/(dashboard)/settings/<slug>/page.tsx`.

**Empty-state placeholder pages** use `SettingsPlaceholder` (see
`src/components/settings/settings-placeholder.tsx`) which takes a title,
description, list of expected items, and an optional "depends on" string
so future contributors know what the section will eventually hold and
what's blocking it.

---

## Interaction Patterns

### Transitions
- Page enter: `fadeIn 0.22s ease-out` (opacity 0→1, translateY 4px→0)
- Button active: `translateY(0.5px)`
- Nav/button hover: `transition 0.12s ease`
- Card hover: `transition 0.16s ease`

### Focus
- All focus-visible: `outline: 2px solid brand-500, offset 1px`

### Scrollbars
- Thin custom scrollbar: 8px width, #c9ced4 thumb, transparent track
- Apply `.scrollbar-thin` class to scrollable containers

### Per-browser UI preferences (localStorage)
- For small conveniences only (a collapsed rail, a remembered toggle), never data.
- Read with `useSyncExternalStore(subscribe, readFromStorage, () => default)`: the server snapshot is the default, so there's no hydration mismatch and no setState-in-effect. Write with a helper that saves and dispatches a custom window event the subscriber listens to (plus `storage` for other tabs).
- Wrap every storage read/write in try/catch: private mode or blocked site data must fall back to the default.
- Example: the viewer file tree's collapsed state (`src/components/documents-viewer/document-file-tree.tsx`).

---

## Color Coding

### Practice areas and matters
Area and matter colours are data, not design tokens: `PracticeArea.color` and
`Matter.color` (validated hex, see `src/lib/queries/sidebar.ts`). The old
`--color-area-*` tokens and `.text-display` class no longer exist.

### Semantic
| Meaning | Color | Var |
|---|---|---|
| Positive / filed / ok | `#2d8a5f` | `--color-ok` |
| Warning / unfiled | `#b6623d` | `--color-warn` |
| Danger / opposing | `#c13c3c` | `--color-danger` |
| Highlight / amber | `#fff1bd` | `--color-highlight` |

---

## Forms, dialogs and server actions (React 19)

### Keep input after a server error: dispatch manually

React 19 resets every `<form action={fn}>` form after the action settles,
error or not. That wipes typed text and snaps controlled/uncontrolled
`<select>`s back to their first option when the server returns a validation or
business-rule error. A controlled checkbox alone does not survive the reset.
Forms that must keep their input dispatch from `onSubmit`:

```tsx
const [, startSubmit] = useTransition();
const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget); // pass e.nativeEvent.submitter too when a submit button's name/value matters
  startSubmit(() => formAction(fd));
};
```

Native `required` validation still runs before `onSubmit`. Reference
implementation: `src/components/matters/billing/trust-transaction-form.tsx`;
also used by the profile/security/login forms, NoteComposer, ReplyComposer,
parties forms, the document composer (fetch/upload instead of `useActionState`)
and the settings forms. Forms that call the action directly inside
`startTransition` and read its result (no `useActionState`) are the same idea.
Many older forms still use `<form action>`; migrate them when touched,
especially any with a `<select>`.

### `useDialogActionState` for always-mounted dialogs

`useActionState` keeps its last state forever. Row menus and tab surfaces mount
their dialog or collapsible composer unconditionally (only the content
unmounts on close), so a failed attempt's banner would reappear on the next
open. `useDialogActionState(action, initialState, open)`
(`src/hooks/use-dialog-action-state.ts`) masks state from before the last
open/close flip and exposes `initialState` until a NEW state object arrives.
Rules: `initialState` must be a stable module constant; close-on-success
effects key on the state OBJECT, not `state.status`; tests must return a fresh
object per call (a mock that returns one shared object defeats identity checks).

Dialog structure that works with it: an outer component (the hook plus the
close-on-success effect) and a form body inside `DialogContent` that remounts
per open, seeding its working copies without a reset effect (see
`RecordPaymentDialog`). Use the manual dispatch above, because a controlled
`<select>` is otherwise reset by the post-action form reset.

### Reset or reseed without `set-state-in-effect`

The lint config forbids effect-driven resets. Alternatives in use:
- close/reset on success inside a wrapped action, after the awaited server call;
- reseed in the open handler, or via a keyed per-open form body;
- "stored previous prop" (compare to the last prop during render and adjust
  state) for controlled selects and dialogs that must follow prop changes
  (EditMatterForm lead/client, edit/log-time/stop-timer dialogs, the evidence
  composer on a new anchor object);
- "adjust state when the action state object changes" during render in place of
  a success effect (settlement composers).

### Dates in client components (ADR-012)

Client components render on the UTC host first and hydrate in the browser, so
never use browser-local `Date` getters or zone-less `formatDate`. Use:

| Value | Examples | Helper |
|---|---|---|
| Date-only (a calendar day) | `TimeEntry.date`, deadline/task due dates, SOL, all-day events, `Firm.establishedAt` | Send/receive as `dateOnlyKey` strings; display with `formatDateOnly`; never convert to a `Date` in the browser. Parse server-side with `parseDateOnly` (UTC midnight). "Today" is `todayKey(useUserTimeZone())`. |
| Instant | `createdAt`, email dates, event start/end | `useUserTimeZone()` + `formatDate(value, format, tz)` |
| `datetime-local` input | event, call log, composer times | Seed with `toWallClockInput(date, tz)`, read on the server with `parseWallClock(value, tz)` (profile zone) |

All in `src/lib/format-date.ts`; the zone comes from the profile
(`getCurrentUserTimeZone()` on the server, `useUserTimeZone()` in
`src/components/user-time-zone.tsx` on the client). Calendar clients take timed
values as the profile-zone wall clock and all-day values as date-only keys
(`src/lib/event-schedule.ts`, `components/calendar/grid-time.ts`,
`bucket-items.ts`); bucket multi-day events with `eventDayKeys`.

### Other conventions

- Client-visible redirect targets go through `safeRedirectPath`
  (`src/lib/safe-redirect.ts`).
- Hide controls from server-computed booleans (e.g. `getNoteAccess()`, the
  `canCreate`/`canEdit` props); the server action re-checks regardless.
  `EventAttachmentsProvider` (`components/calendar/event-attachments-context.tsx`)
  passes the viewer's pin/delete permissions to shared event notes/time sections.
- Idempotent per-user toggles take the wanted state (`setMatterPin(id, wanted)`,
  `setEmailThreadStarred`), not a blind flip.
- `ReplyComposer` must be keyed by thread id wherever it is mounted.
  `EmailLink` renders non-single-address values as plain text; use `mailtoHref`
  for other mailto links.
- Command palette: cmdk `value` is row identity, so every row needs a unique uid
  (`paletteValue(kind, text, uid)`); recents are per user in localStorage.
- Shared form helpers: `components/matters/form-primitives.tsx` `Field` wires
  `aria-invalid`/`aria-describedby` to its control; settings forms use the shared
  settings `Field` and `FormErrorBanner`; the client typeahead is an ARIA
  combobox (`parties/party-pickers.tsx`).
- Event modal: focus moves in on open, Tab is trapped, focus is restored, Escape
  layers via a document-level handler that stops propagation; remounts per event
  id; `[data-modal-composer]` blurs first.
- `Button` with `render={<Link/>}` or an `<a href>` keeps native link semantics
  (no `role="button"`). `DialogContent` is viewport-capped with internal scroll.
- Primitives present in `src/components/ui/` are the ones in use; unused shadcn
  primitives (calendar, label, scroll-area, select, separator, sheet, tabs,
  tooltip) were deleted: re-add with `shadcn add` when needed (a re-added base-ui `Select` needs `items` on `<Select>` or the trigger shows the raw value).
- Reorderable dialog lists use stable row keys, not indexes.
- **Confirm before a save changes other records** (ADR-040): the action
  returns `status: "confirm"` with the list and writes nothing; the form
  renders `CascadeConfirm` (`components/automations/cascade-confirm.tsx`)
  INSIDE itself, so its checkboxes (`cascadeId`) and the two submit buttons
  (`cascadeDecision=apply|skip`) post with the user's other fields — submit
  with `new FormData(form, submitter)`. Show the panel only for the value it
  was computed for (track the submitted value; editing it again drops the
  stale list), and hide the plain Save while it's up.
- Multi-connection-pool lock tests: see TESTING.md.

## Adding a matter-scoped page or action (matter access)

Every page under `matters/[id]` (and any page or route reached with a matter or child id) must restrict itself, ADR-039:

```ts
export default async function Page({ params }) {
  await requireUser();                       // first await stays the session guard
  const { id } = await params;
  await assertMatterAccess(id);              // 404 when hidden
  ...
}
```

- Server actions: `requirePermission(key)` first, then `assertMatterAccess(matterId)` or `assertChildMatterAccess("note", noteId)` BEFORE any write.
- Lists/aggregates: spread `matterAccessWhere(userId)` into a Matter query, `matterRelationAccessWhere(userId)` into a child with a required matter, `optionalMatterAccessWhere` for nullable matters.
- Never return a 403 or a "no access" message; hidden looks missing. Show calendar items on hidden matters as Busy.
- `page-guards.test.ts` and `matter-access-guards.test.ts` fail the build if you forget; justify exceptions in their allowlists.
