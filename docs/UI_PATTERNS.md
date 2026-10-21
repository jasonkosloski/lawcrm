# UI Patterns & Component Conventions

Reusable patterns applied across the app. Reference this when building new screens.
The system is v2 ([ADR-057](decisions/057-ui-system-v2-legibility-floor-and-colour-on-meaning.md)):
a legibility floor, and colour spent only on meaning.

---

## Identity

**Warm paper, ink chrome, the firm's navy.** People read this app all day, so it is quiet
by default and loud only where something needs a decision.

- Ground `paper` #f7f6f2; cards white with a 1px `line` border; email reader `paper-email`.
- Sidebar on the ground behind one hairline. No gradients, glows or tinted tiles anywhere.
- **Colour goes on meaning:** urgency (`danger` overdue, `warn` due soon), status (pale pill
  pairs), money that moved, practice-area and matter colours (data from the DB), and the
  one primary action. Chrome (nav, tabs, selection, headers) is ink and neutral.
- Primary action: `Button` default, the deep navy `brand-700`. `brand-500` is for links,
  the focus ring and small selection marks only.

## Type

Inter for all UI; Fraunces for page titles (`TopBar` h1), the brand mark and email reading.
`font-mono` renders **Inter with tabular figures** (use it, or `tabular-nums`, for times,
money and counts); `font-code` (JetBrains Mono) is for code only.

| Token | Size | Use |
|---|---|---|
| `text-3xs` | 11px | The floor. Dense chips only |
| `text-2xs` | 11.5px | Meta: timestamps, counts, secondary lines, table headers, section labels |
| `text-xs` | 12.5px | Body: table cells, row titles, form text |
| `text-sm` | 13.5px | Nav, lead rows, card body where there's room |
| `text-[15px] font-semibold` | 15px | Card titles (`CardTitle`) |
| Fraunces `text-xl` | 20px | Page title |

- **Nothing under 11px**: no `text-[9px]`/`[10px]`.
- **No uppercase or letter-spaced labels.** Section labels, field labels and table headers
  are sentence case. (Exception: keyboard hints and initials.)
- **Ink tiers:** `ink` identity and values · `ink-2` body · `ink-3` labels · `ink-4` meta.
  All four are ≥4.5:1. `ink-5` only for placeholders and decorative icons. A row's identity
  (name, subject, title) is never `ink-4`.

---

## Component Patterns

### Headline figures (`StatStrip`)
```
src/components/shared/stat-strip.tsx — one bordered card split by hairlines.
- Label 11.5px ink-3 above a 24px value; optional 11.5px ink-4 detail line.
- Columns follow the item count (no orphan cells); 2-up on phones, odd last cell spans.
- No icons, no tints. `tone` colours a value only when it needs attention.
- `href` makes a cell a link (to the list that explains the figure).
```

### Due dates (`DueLabel`)
```
src/components/shared/due-label.tsx — "Oct 25 · 5d", "Today", "Tomorrow", "Oct 18 · 2d late".
- Overdue: danger. Due within 2 days: warn. Otherwise grey.
- dueDate is date-only (ADR-012); days is computed on the server against the viewer's today.
- Every due date or countdown in the app renders through it.
```

### Status chip
```
Pale tint + dark text of the same hue, 12px, h-5, rounded-full, never squeezed (shrink-0).
- ok:     bg-ok-soft text-ok         (filed, paid, done, converted)
- warn:   bg-warn-soft text-warn     (due soon, unfiled, needs review)
- danger: bg-danger-soft text-danger (overdue, failed, conflict)
- brand:  bg-brand-soft text-brand-700 (new, an applied filter)
- neutral: bg-paper-2 text-ink-3     (everything else)
One status mark per row.
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

### Navigation and selection
```
Sidebar item: 30px tall, 13.5px, 16px outline icon (ink-4; ink when active).
  Active: bg-sidebar-accent (neutral pill), ink label, font-medium. Hover: bg-paper-2.
  Counts: 12px tabular grey; queues that need action (unread email, new leads) in ink semibold.
Selected list row (inbox, mailbox, settings nav): bg-paper-2 / bg-sidebar-accent, never a brand fill.
Underline tabs: active text-ink + 2px ink underline; inactive ink-3.
Segmented control: bg-paper-2 track, white active option with shadow-sm.
```

### Card
```
Card: rounded-lg, 1px line border, no shadow. CardTitle 15px semibold ink, with an optional
12px grey count and a right-aligned action.
Clickable card: `card-hover` (the edge darkens; no lift, no blue glow).
```

### Table
```
- Header: 11.5px ink-4 sentence case, medium; no fill band.
- Rows: h-10, 12.5px, border line-2 between rows, hover bg-paper/70. No zebra.
- Numbers right-aligned and tabular; zero money in ink-4; missing values "—".
- Shared primitives: src/components/ui/table.tsx.
```

### Button hierarchy
```
Primary (default): brand-700 fill, white text, hover brand-900. One per screen.
Outline: white, border-input, ink-2 text. Secondary actions.
Ghost: transparent; tertiary and icon buttons.
Destructive: white with danger text and a danger/30 border.
Heights: h-9 default, h-8 sm, h-7 xs.
```

### Dropdowns (`NativeSelect`)
```
src/components/ui/native-select.tsx — never a raw <select> (ESLint enforces).
- Native on purpose: posts with the form, OS picker on phones,
  userEvent.selectOptions in tests. Use a Popover+Command combobox
  (attendee-picker) only when options need search or rich rows.
- className sizes the WRAPPER (default w-fit): pass w-full in form
  fields. size="sm" (h-7) for toolbars.
- Errors: aria-invalid, not a conditional border class.
```

### Action feedback (toasts and confirmations)
```
src/lib/feedback.ts — never window.alert/confirm/prompt (ESLint no-alert).
- notifyError(msg): a mutation failed; show the server's message or what to try next.
- notifySuccess(msg): it worked AND nothing on screen already shows it
  (a row disappearing or a value changing is its own confirmation).
- await confirmAction({ title, description, confirmLabel, destructive }):
  title is the question ("Delete this note?"), description the
  consequence ("This can't be undone."), confirmLabel names the action
  ("Delete note", never "OK"), destructive for losses. Await it BEFORE
  startTransition.
- Rendered by <Toaster> and <ConfirmHost>, mounted once in Providers.
- Field-level validation stays inline next to the field (useActionState).
- Tests: vi.mock("@/lib/feedback") and assert on the mocks.
```

---

## Layout Patterns

### Dashboard cards
Every dashboard card renders on the shared frame in `src/components/dashboard/dashboard-card.tsx`:
- `DashboardCard`: title (CardTitle style, not Fraunces; count in grey tabular figures), optional "View all" link (only when a destination page exists), body.
- `DashboardRow`: one list row inside a card (`border-line-2` rules, `hover:bg-paper`).
- `LatePill`: the overdue pill (`danger-soft`/`danger`, no border). Due dates in rows use `DueLabel`.

Cards size by container query (`@container` on the card, `@sm:`/`@2xl:` variants inside), not viewport breakpoints, because the same card renders in the full-width band and in 4-, 6- or 8-column slots. Exception: `KpisCard` renders a `StatStrip` (see Headline figures), not a `DashboardCard`.

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

Implementation: `src/components/matters/matter-tabs.tsx` (client, `usePathname()` picks the active tab; list is the `TABS` constant). Overview is the base route; other tabs are nested routes. No contextual Add button on the bar; creation lives in the header Create menu and each tab's own composer. Loading skeletons nested under a layout that renders its own header use `<PageSkeleton withTopBar={false} />`.

### Matter or intake scope (`RecordScope`)

Composers, the notes list, the documents browser and the Records tab take a `scope` (`src/lib/record-scope.ts`: `{ kind: "matter", matterId }` or `{ kind: "lead", leadId }`) instead of a bare `matterId`. The scope picks the server action (`createNote` / `createLeadNote`, `createTaskWithCaptures` / `createLeadTask`, `createEventWithCaptures` / `createLeadEvent`). On a lead the matter-only affordances are hidden: sibling captures (pages pass `siblingKinds={[]}` / `allowedKinds={[]}`), attached tasks/deadlines/time, Convert to task/deadline, log time and add note on a task. Shared server components serve both routes: `TaskListByStatus` (`src/components/tasks/task-list-by-status.tsx`, `matterId={null}` on a lead), `DocumentsBrowser` / `DocumentViewerBody` (`src/components/documents/`; hrefs from `scopeBasePath`, uploads send `leadId` for a lead). Intake tabs live in `src/components/intake/intake-tabs.tsx`. A converted lead's tabs show a banner linking to the matter instead of a composer and are read-only. Data model: `SCHEMA_NOTES.md` scope pattern.

### Request detail page (Records tab)

A detail view that needs deep-linking and back/forward gets its own nested route rather than a modal: `/matters/[id]/records/[requestId]` and `/intake/[id]/records/[requestId]` (the layout keeps the tabs; Records stays highlighted); rows link with a plain `Link`. The route pages own auth (`requireUser`, the matter wall, `records.view`); the shared server component `src/components/records-requests/request-detail-page.tsx` loads the scoped record (a foreign or missing id 404s) and renders the client `request-detail.tsx`. Layout: header, then two columns on lg+ (main / side), stacked below. Data the viewer may not see (fees) is not sent to the client at all. Delete navigates back to the list.

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

**Architecture:** `CommandPaletteProvider` (client, mounted in `AppShell`) owns open state and the global shortcut; `useCommandPalette()` (`open`, `openPalette`, `closePalette`, `togglePalette`) lets any client component trigger it. Data is fetched per open via the `getPaletteData` server action (`src/lib/queries/command-palette.ts`); cmdk filters in memory.

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

1. `CreateStackProvider` (client) is mounted inside a layout that hosts the stack (`matters/[id]/layout.tsx`; directly on `calendar/page.tsx`). It holds `panels: CreatePanel[]` + `focusedId` in React state. Next.js layouts don't remount on child route changes, so the stack survives navigation within its subtree.
2. `useCreateStack()` exposes `open(type)`, `close(id)`, `focus(id)`, `setExpanded(id, bool)`. Triggers (header Create dropdown, empty-state CTA, "+ New event") call `open(type)`; URL params are not involved.
3. Optional `context` prop (color + label + sublabel) drives the expanded-mode context strip. Matter detail passes the matter's; calendar passes nothing (an event might be firm-wide).
4. `CreateDock` (`src/components/create-stack/create-dock.tsx`) renders the focused panel (docked right-rail or expanded modal). Non-focused panels render as compact chips inside the focused panel's chrome, right below its header (under "Also open", only when 2+ panels are open): always in the user's line of sight and never overlapping the active panel's controls.
5. **Every open panel's body stays mounted.** `CreateDock` renders one `PanelBody` per open panel, keyed by panel id, inside a single persistent shell; only the focused body is visible (others `hidden`). Each body's own React state IS its draft, so it survives expand/collapse and focus switches, and no two panels share a form instance. The provider holds only panel metadata (id, type, expanded) and the focus pointer, never form values. Don't move a body into a conditional JSX branch or key it by anything but panel id: that remounts it and drops the draft.

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

**Use it** for any "do something without losing context" flow where multiple simultaneous drafts are plausible (a modal blocks and is one at a time; a full-page route loses context).

**Deferred:** deep-linking to a panel state (`?create=<type>` doesn't serialize a multi-panel model; add back as seed-on-mount if needed).

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

### Client portal

The portal (`src/app/(portal)/portal/`) is for clients, not staff: often stressed, non-technical and on a phone. Same brand tokens, different register.

- **Letterhead header:** `bg-brand-900` band, firm name in Fraunces, `brand-gradient-line` under it. This is the portal's one bold element; keep everything else quiet on `bg-paper-2`.
- **Type is larger than staff UI:** body `text-sm`, page titles Fraunces `text-3xl` in `text-brand-900`, matter names Fraunces `text-base`. No 10px mono labels, no all-caps; labels are sentence case (shadcn `Label`).
- **Touch targets:** inputs and primary buttons `h-10`; list rows at least `min-h-16`, the whole row is the link, with a visible `focus-visible` ring.
- **Shared pieces:** `AuthPanel` (sign-in card), `PortalMessage` (404/error: icon, title, plain explanation, a way home), `MatterStatus` (Open = ok chip, Closed = neutral chip), `PortalOff`, and the shared `EmptyState`.
- **Copy:** plain words, says what happens next ("We'll email you a secure link"), points to a person when stuck ("call or email the office"). Never show staff vocabulary, error text or internal IDs.
- **Uniform auth copy:** the link-request result reads the same whether or not the email has access; don't add copy that varies by account.

## Interaction Patterns

### Transitions
- Motion is feedback only: hover/press 0.12s, page enter `fadeIn 0.22s`.
- `prefers-reduced-motion` is honoured globally (globals.css); loops use `motion-safe:`.

### Focus
- All focus-visible: `outline: 2px solid brand-500, offset 2px` (global base style;
  components with their own ring keep it).

### Scrollbars
- Thin custom scrollbar: 8px width, warm grey thumb, transparent track
- Apply `.scrollbar-thin` class to scrollable containers

### Floating layers
- Only things that float get a shadow: menus, popovers, dialogs, the Create dock and the
  timer. The idle timer is a 36px icon button so it covers as little as possible.

### Long lists: paginate, never truncate
- A list that can outgrow one screen never cuts rows silently. Default: offset paging by `?page=N` (the URL is the source of truth, ADR-007). Helpers in `src/lib/pagination.ts`: `parsePageParam` for the param, `paginate(page, size, count, fetch)` for a Prisma read (count and fetch share ONE `where`, so matter-access clauses filter the total too), `paginateArray` when rows must be sorted in JS first (matters list). Junk or out-of-range pages clamp, never 404.
- Order by a unique tiebreak (`[{ lastMessageAt: "desc" }, { id: "desc" }]`) so rows don't repeat or vanish across pages.
- Render `<Pager>` (`src/components/shared/pager.tsx`) with the list's base href; build it with `hrefFromSearchParams(path, sp)` on a server page so the filters survive. Row links that open a reader keep `?page=` (`withPageParam`), and `useUrlParams` drops `page` on every filter/sort write so a new filter starts on page 1.
- When paging isn't worth it (a capped scan, a match with a post-filter), fetch `cap + 1`, return a `truncated` flag, and render `<TruncationNotice>` saying how many are shown and how to narrow. Never compare `rows.length` to a literal; use the exported constant.
- Examples: `listThreads` + `/communication`, `listMatters` + `/matters`, `listLeads` (closed history) + `/intake`, `getNotificationsFeed` + `/notifications`.

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
| Positive / filed / paid | `#23744d` | `--color-ok` (+ `ok-soft`) |
| Warning / due soon / unfiled | `#9a4a26` | `--color-warn` (+ `warn-soft`) |
| Danger / overdue / failed | `#b02a2a` | `--color-danger` (+ `danger-soft`) |
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

### Generated-folder badge

System-generated folders (`DocumentFolder.systemKind`) show
`FolderSourceBadge` (`components/documents/folder-source-badge.tsx`): a small
rounded chip with a clipboard icon linking to the source record. It renders
nothing for ordinary folders. Tree rails are already links, so they show only
an icon (no nested link). Hide menu items the server would refuse
(`isProtected`, `hasProtectedDescendant` on `FolderRowActions`).

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
  combobox (`matters/parties/party-pickers.tsx`).
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

## Adding a matter-scoped page or action

Every page under `matters/[id]` (and any page or route reached with a matter or child id) must restrict itself (ADR-039): `await requireUser()` stays the first await, then `await assertMatterAccess(id)` (404 when hidden). Actions: `requirePermission(key)` first, then `assertMatterAccess` / `assertChildMatterAccess(kind, id)` BEFORE any write; list queries spread the `matterAccessWhere` family. Never return 403 or a "no access" message (hidden looks missing); show calendar items on hidden matters as Busy. Full helper table and enforcement tests: `PERMISSIONS.md` (Matter access); `page-guards.test.ts` and `matter-access-guards.test.ts` fail the build if you forget.
