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
reading `usePathname()` to pick the active tab. 8 tabs: Overview, Timeline,
Documents, Parties, Deadlines, Tasks, Notes, Billing. Overview is the base
route (`/matters/[id]`); other tabs are nested routes.

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

### Tab Placeholder

Shared empty state for matter detail tabs that haven't been built out yet.
Uses a centered card in the tab content area with the tab name + a short
description of what's coming. Lets users click through the full tab set
without running into blank/404 pages. See `src/components/matters/tab-placeholder.tsx`.

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

---

## Color Coding

### Practice Areas (consistent across sidebar, chips, dots, calendar)
| Area | Color | Var |
|---|---|---|
| §1983 / Civil rights | `#2563a8` | `--color-area-1983` |
| Housing / FHA | `#2d8a5f` | `--color-area-housing` |
| Employment / CADA | `#b6623d` | `--color-area-employment` |
| Criminal | `#6b4e7d` | `--color-area-criminal` |
| Class actions | `#8a6a2d` | `--color-area-class` |
| ADA | `#3a8a7a` | `--color-area-ada` |

### Semantic
| Meaning | Color | Var |
|---|---|---|
| Positive / filed / ok | `#2d8a5f` | `--color-ok` |
| Warning / unfiled | `#b6623d` | `--color-warn` |
| Danger / opposing | `#c13c3c` | `--color-danger` |
| Highlight / amber | `#fff1bd` | `--color-highlight` |
