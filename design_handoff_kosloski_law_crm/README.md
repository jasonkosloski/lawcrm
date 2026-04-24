# Handoff — Kosloski Law CRM

A firm-wide practice-management application for a small plaintiffs' civil-rights firm. The prototype covers the working day of an attorney: cases (matters), email, calendar, contacts, documents, time & billing, tasks, financials, and team/admin surfaces.

---

## About the design files

Everything in `prototype/` is a **design reference built in HTML + React (via in-browser Babel)**. It is not production code.

- The prototype renders by loading several `<script type="text/babel">` JSX files. Babel transpiles them live in the browser.
- The data is mocked inline in each `app-*.jsx` file.
- There is no build step, no server, no router (navigation is a tiny `go(path)` hash router).

**Your job is to re-implement these screens in the target codebase** using its existing framework (React, Next.js, Remix, SwiftUI, or whatever the real app is). If no codebase exists yet, React + TypeScript + a real router is the closest match to what's here — but the layout decisions, color system, typography, and component behavior described below are what matter, not the specific file structure.

Copy the **design intent and pixel detail** from the prototype. Don't copy the file layout, the MF namespace, or the Babel-in-browser setup.

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and interaction patterns are fixed. Exact hex values, type sizes, radii, and paddings are listed below and visible in `prototype/mf-lib.jsx` + `prototype/app-blue.jsx`. Hover/active states, transitions, and the multi-pane layouts should be recreated pixel-perfect.

---

## How to view the prototype

1. Serve the `prototype/` folder from any static server (e.g. `python3 -m http.server` or `npx serve`).
2. Open `Kosloski Law CRM.html`.
3. Navigate with the left sidebar or the Command Palette (`⌘K`).
4. The app has a Tweaks toggle in the preview toolbar that surfaces some theme/copy knobs — ignore this in the real build.

---

## Product architecture

### Global shell

Every screen lives inside `AppShell`:

```
┌────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌─────────────────────────────────────────────────┐ │
│  │ sidebar  │  │ topbar (crumbs + title + search + actions)      │ │
│  │ 240px    │  ├─────────────────────────────────────────────────┤ │
│  │          │  │                                                 │ │
│  │ nav      │  │ page content (flex:1, min-height:0)             │ │
│  │          │  │                                                 │ │
│  │ status   │  │                                                 │ │
│  └──────────┘  └─────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

**Sidebar (240px fixed):**
- Firm logo tile (gradient blue square with "k" glyph) + firm name.
- Navigation, grouped by section (`WORK`, `PEOPLE`, `FINANCE`, `ADMIN`). Each item: 14px icon, label, optional badge, optional keyboard shortcut pill (`⌘K` style).
- Active nav item: solid blue-500 background, white text, soft inner highlight.
- Hover (inactive): `#eaf0f5` background, blue-700 text.
- Bottom status strip: Jane Marsh's avatar + role + last-sync indicator.

**Topbar (56px):**
- Crumbs in uppercase tracking-wide muted tone.
- Page title in Fraunces display font.
- Right side: global search (⌘K), page-specific buttons (Compose, New matter, etc.), user menu.
- 3px brand gradient hairline along the top edge (`--blue-500 → --blue-300 → #e5e4de`).

---

## Screens

All numbered screens below correspond to the `go(path)` router keys in the prototype.

### 1. Home / Dashboard (`home`)
Three-column layout:
- **Left column (flex):** KPI tile grid (4 cards: Open matters, Unread email, Hours today, Trust balance) with subtle directional gradients; "Today" agenda (list of time-blocked events with color dots); Recent activity feed.
- **Right column (340px):** Deadlines this week (ordered list with days-until badges), Upcoming conflicts-check queue, Firm pulse mini-chart.

KPI tile: 12px padding, 8px radius, 1px border `#e5e4de`, `::before` gradient overlay by category (`.k-accent` blue, `.k-critical` warm, `.k-ok` green, default blue-tint).

### 2. Matters list (`matters`)
Dense, sortable table with a sticky header row and a left filter rail:

- Columns: Matter name + client, Area, Phase (pipeline chips), Lead, Next deadline, Trust, Updated.
- Row hover: `var(--blue-tint)` background.
- Clicking a row navigates to `matter/<id>`.

### 3. Matter detail (`matter/<id>`)
The most complex screen. Four tab levels:

- **Top matter header:** Matter name (Fraunces 24px), status chips (phase · area · lead avatars · trust balance · last activity). Right: "New deadline", "New document", "Log time" buttons.
- **Subtabs** (horizontal, blue underline when active): Overview · Parties · Documents · Evidence · Emails · Time · Billing · Notes · Tasks · Calendar · Filings.
- **Body** varies per tab. See `app-matter.jsx` for full content — the Overview tab shows a summary pane + a timeline; the Emails tab uses `MatterEmails` from `app-email.jsx` (summary strip + two-pane list/reader).

### 4. Email (`email`) — **primary focus of the latest iteration**

Three-pane layout with a toggleable details drawer:

```
┌──────────┬────────────┬───────────────────────────────────────┬──────────┐
│ Mailboxes│ Thread list│ Reader (dominant)                     │ Details  │
│ 200px    │ 360px      │ flex                                  │ 280px    │
│          │            │                                       │ (toggle) │
│          │            │  ┌─────────────────────────────────┐  │          │
│          │            │  │ topbar: matter-filed chip +     │  │          │
│          │            │  │ Archive/Refile/Labels/Expand-   │  │          │
│          │            │  │ all/Details/…                   │  │          │
│          │            │  │ subject (Fraunces 22px)         │  │          │
│          │            │  │ label chips                     │  │          │
│          │            │  ├─────────────────────────────────┤  │          │
│          │            │  │ [collapsed msg] sender · snippet│  │          │
│          │            │  │ [collapsed msg] sender · snippet│  │          │
│          │            │  │ ┌─────────────────────────────┐ │  │          │
│          │            │  │ │ EXPANDED — newest message   │ │  │          │
│          │            │  │ │ (blue-left-border accent,   │ │  │          │
│          │            │  │ │  Fraunces body, paragraphs, │ │  │          │
│          │            │  │ │  attachments)               │ │  │          │
│          │            │  │ └─────────────────────────────┘ │  │          │
│          │            │  │ [reply stub — click to compose] │  │          │
│          │            │  └─────────────────────────────────┘  │          │
└──────────┴────────────┴───────────────────────────────────────┴──────────┘
```

**Mailboxes column (200px, `#fbfafa` bg):**
- Compose button (primary blue, full width).
- "My inboxes" section: Inbox / Unfiled / Starred / Sent / Drafts with counts and shortcut pills (`1`, `2`).
- "By matter (shared)" section: one row per open matter with a 6px color dot and tagged-email count.
- Bottom strip: Gmail sync status (tiny mono block with green dot, OAuth label, threads indexed, "Manage integration →" link).

**Thread list (360px, white bg):**
- Search input (Inter 12px, 30px tall) with live result count.
- Filter pills below: All / Unread / Unfiled / Attach — each with a count badge.
- Each thread row: 12px/14px padding, bottom border.
  - Row 1: owner avatar (20px), owner first name (mono 10px muted), optional "sent" chip, star icon, timestamp.
  - Row 2: sender name (13px, semibold if unread).
  - Row 3: subject (12.5px, single-line ellipsis).
  - Row 4: snippet (11.5px muted, 2-line clamp).
  - Row 5: matter chip (blue-500 filled with folder icon + ellipsized matter name) OR dashed "unfiled" pill (warm tone), followed by label chips and attachment count.
- Selected row: `var(--blue-soft)` bg, 3px left blue border, other rows transparent or `#fcfbf8` when read.

**Reader (flex, paper tone `#faf8f3`):**
- Content wrapper capped at `max-width: 780px` for readability.
- **Topbar:** matter-filed pill OR unfiled warning strip (with suggested matter + confidence pct). Action cluster: Archive · Refile/File · Labels · Expand all / Collapse all · Details (toggles right drawer) · ⋯.
- **Subject:** Fraunces 22px, deep navy `#0f1b2e`, letter-spacing -0.01em, line-height 1.25.
- **Label chips** below subject (privileged = warm yellow; opposing-counsel = warm red; auto-filed = green).
- **Opposing-counsel banner** (if applicable): warm-red tinted strip with warn icon, "Do not forward externally" copy.
- **Messages (new accordion):**
  - Older messages render as a single-row summary (avatar · sender · first-line preview · timestamp), white card, 1px border, rounded 8px. Click to expand.
  - The **latest message is expanded by default** with a 3px blue-500 left border, blue-tint header background, avatar (28px), sender "Name <email>" + "to recipient · timestamp · privileged" metadata row, Reply button.
  - Body renders each paragraph with `white-space: pre-wrap`, Fraunces 13.5px / line-height 1.62.
  - Attachments render below the body with a dashed top separator, section label, and file cards (28×32 colored tile with file extension, filename, size, "save to Evidence ↓").
- **Reply stub** at bottom: dashed border card with avatar + "Reply as jane@kosloskilaw.com" + Reply / Reply all / Forward buttons. Click the card or a button to open the Compose window.

**Details drawer (280px, closed by default):**
- Toggle via the Details button in the reader topbar. Close via its own × or the toggle.
- Sections: Thread details (participants, domain, direction, message count) · Matter (clickable matter card with tagged-email badges) · Actions (log time, save attachments, extract deadline, add party, apply privilege — each is an icon tile + label + sub-label) · Gmail sync (monospace metadata: message ID, labels, thread summary, last-sync).

**Compose window (`ComposeWindow`):**
- Three modes: **expanded** (center modal with backdrop), **docked** (560×520 bottom-right), **minimized** (360px bottom-right stub).
- Blue gradient header (`linear-gradient(180deg, --blue-500, --blue-600)`) with: icon, "New message"/"Reply" title, matter chip (white-on-blue pill), minimize/expand/discard buttons.
- Fields: From (auto, read-only), To, Cc/Bcc toggles, Subject, Matter picker (dropdown of open matters with color dots + area pills), Template picker (engagement letter, CGIA notice, litigation hold, demand, client status).
- Body: plain textarea placeholder.
- Footer: Send button (primary blue), "Log time on send" checkbox, discard.

---

### 5. Calendar (`calendar`)
Month/week toggle, per-matter color coding, deadline markers, "Today" pill anchored to current time line.

### 6. Contacts (`contacts`)
Left rail (types: clients / opposing / experts / courts / vendors). Main area: card grid or table with avatar, role, matters-touched, last-contact.

### 7. Documents (`documents`) / Evidence (per-matter)
Folder tree + file grid. File cards: extension tile (color-coded by type), filename, size, mod-date, owner avatar, "Open in Word/PDF/…" action.

### 8. Time (`time`) & Log time entry (`time-entry`)
- **Time page:** Week grid with hour bars per matter, running totals, unbilled chip, "Bill now" shortcut.
- **Log time modal:** Duration, matter picker, narrative, billable toggle, rate override, save + continue.

### 9. Financial pages (`invoices`, `trust`, `financials`)
- Invoices: table with status chips (Draft / Sent / Paid / Overdue), total and aging.
- Trust: IOLTA balance by matter, recent transactions, reconciliation status.
- Financials: AR/AP rollups, realization %, collection rate.

### 10. Tasks (`tasks`)
Kanban-esque: Today / This week / Later / Done. Each card shows matter, due-date, owner avatar, priority flag.

### 11. Team/admin (`team`, `settings`)
User roster, role assignments, integration statuses (Gmail, Westlaw, calendar, e-sign, IOLTA).

---

## Design tokens

### Color

**Blue scale (brand — defined in `app-blue.jsx`):**
```css
--blue-50:  #f0f6fc;
--blue-100: #dbeafe;
--blue-200: #b3d4ec;
--blue-300: #7fb4d9;
--blue-400: #4a8fc2;
--blue-500: #2563a8;   /* primary brand blue */
--blue-600: #1e4f88;
--blue-700: #18406e;
--blue-900: #0c2443;
--blue-soft: #eaf3fa;  /* selected-row / soft fill */
--blue-tint: #f6faff;  /* lightest wash */
```

**Neutrals (warm paper — defined in `mf-lib.jsx`):**
```
ink    #14181f   body text, strong
ink2   #3a4251   secondary text
ink3   #6b7280   tertiary / meta
ink4   #9aa1ad   quaternary / placeholder
line   #e5e4de   hairline borders
line2  #eeece6   softer divider
bg     #faf9f5   app canvas (warm paper)
bg2    #f3f1ea   soft fill / subnav
card   #ffffff   card/surface
```

**Semantic:**
```
hi     #fff1bd   highlight (amber)
ok     #2d8a5f   positive / filed
warn   #b6623d   warning / unfiled
danger #c13c3c   danger / opposing
```

**Email reader paper:** `#faf8f3` (slightly warmer than the app canvas to feel document-like).

### Typography

```
UI        Inter, ui-sans-serif, system-ui, sans-serif
Mono      "JetBrains Mono", ui-monospace, monospace  (timestamps, code, metadata)
Display   "Fraunces", Georgia, serif                  (page titles, email subjects, email bodies)
```

**Scale (see components for exact usage):**
- Display / page title: Fraunces 22–26px, weight 500, letter-spacing -0.01em.
- Body: Inter 13px, line-height 1.55.
- Email body: Fraunces 13.5px, line-height 1.62.
- Secondary text: 12px, ink3.
- Meta / labels: 10–11px mono, ink3/ink4, sometimes uppercase with `.06em` letter-spacing.
- Chips: 10–11px, semibold when filled.

### Spacing & radius

- Radius: 3px (extension tile), 6px (chip/input/button), 8px (card), 999px (pill).
- Common paddings: 8/10/12/14/16/20 via `.mf-p*` utilities.
- Gap utilities: `.mf-g4 … .mf-g20`.

### Shadows

- Buttons: `0 1px 0 rgba(0,0,0,.02)` normal, `0 1px 0 rgba(0,0,0,.06), 0 4px 10px -4px rgba(37,99,168,.45)` primary.
- Cards on hover: `0 2px 0 rgba(0,0,0,.02), 0 10px 24px -14px rgba(37,99,168,.35)`.
- Modal (Compose expanded): `0 30px 80px -20px rgba(12,36,67,.45), 0 10px 30px -10px rgba(0,0,0,.2)`.
- Logo tile: `0 2px 6px -2px rgba(37,99,168,.6), inset 0 1px 0 rgba(255,255,255,.2)`.

---

## Interactions

- **Keyboard shortcuts:** `⌘K` global palette; `c` compose; `1`/`2` jump between Inbox and Unfiled; `/` focus search (not yet wired in all screens).
- **Command palette:** fuzzy-searches matters, people, documents, screens. Enter navigates.
- **Email accordion:** older messages collapsed by default, latest expanded. Expand-all / collapse-all toggles entire chain. Selecting a different thread resets to "only newest expanded."
- **Details drawer:** off by default on the email reader; opens from topbar Details button.
- **Compose docking:** clicking the expand icon toggles full-screen modal; clicking minimize collapses to a 360px stub bottom-right; the stub remains clickable to re-open.
- **Hover states:** non-primary buttons get `--blue-300` border + `--blue-700` text; table rows get `--blue-tint` bg; card-with-`.app-card-hover` lifts with the blue-tinted shadow above.
- **Focus:** `outline-color: var(--blue-500)` on all focus-visible.

---

## Mock data

The prototype ships with realistic but fictional data:

- **Firm users:** Jane Marsh (Partner), Luis Kosloski (Managing), Rosa Kim (Paralegal), Marco Guerrero (Investigator), Sam Doan (Intake).
- **Matters:** Alvarez v. Aurora PD, Williams v. Denver, In re: Aurora class, Rivera v. Lakewood, Patel (intake), Moreno v. State.
- **Email threads:** Eight full threads with multi-message chains — CGIA notice correspondence, subpoena drafts, Rule 26 disputes, intake inquiries, IOLTA wire confirmations, client photo submissions, vendor invoices, expert-report drafts.

Use this shape as a schema when wiring real Gmail/matter data. Field names (`owners`, `matter`, `matterName`, `messages[]` with `{who, from, fromEmail, to, at, body:[], attachments:[{name,size}]}`) are consistent across the prototype.

---

## Component reference (names used in the prototype)

These live in `mf-lib.jsx` unless noted. Re-implement them as first-class components in your target framework — they are not meant to be ported verbatim.

| Name | File | What it is |
|---|---|---|
| `AppShell` | `app-polish.jsx` | Global sidebar + topbar layout wrapper |
| `AppTopBar` | `app-polish.jsx` | Crumbs + title + actions |
| `GlobalSearch` | `app-polish.jsx` | ⌘K opener |
| `Btn`, `Chip`, `Seg`, `Av`, `Icon` | `mf-lib.jsx` | Primitives |
| `MailboxItem`, `FilterPill` | `app-email.jsx` | Email-specific nav + filter |
| `ThreadReader`, `ComposeWindow` | `app-email.jsx` | Reader accordion + compose modal |
| `MatterEmails` | `app-email.jsx` | Embedded email pane on matter detail |

---

## Files in this bundle

```
design_handoff_kosloski_law_crm/
├── README.md                         ← this file
└── prototype/
    ├── Kosloski Law CRM.html         ← entry point; open in a static server
    ├── mf-lib.jsx                    ← design system primitives + CSS tokens
    ├── app-polish.jsx                ← AppShell, topbar, palette, navigation
    ├── app-pages-1.jsx               ← Home, matters list, calendar, contacts
    ├── app-pages-2.jsx               ← Documents, tasks, team, settings, financials
    ├── app-matter.jsx                ← Matter detail with all subtabs
    ├── app-email.jsx                 ← Email screen (the refreshed one above)
    ├── app-time.jsx                  ← Time tracking week view
    ├── app-time-entry.jsx            ← Log-time modal
    ├── app-blue.jsx                  ← Blue brand palette + component overrides
    └── tweaks-panel.jsx              ← Tweak controls (prototype-only; ignore)
```

---

## Implementation notes

- **Don't ship the Babel-in-browser setup.** Use your framework's compiler.
- **Don't use the `mf-*` class names as your design system.** They exist to namespace against earlier prototype iterations. Rebuild tokens in whatever your project uses (Tailwind, CSS modules, styled-components, vanilla CSS custom properties).
- **The blue palette is the brand.** Everything should hang off `--blue-500` and the scale — buttons, active states, focus rings, the logo tile, KPI accents, table hovers. Preserve this.
- **Respect the warm neutral canvas.** The app is not cold slate gray. Body bg is `#faf9f5`, cards are `#ffffff`, borders `#e5e4de`. The combination of warm paper + saturated navy blue is the personality of the brand — don't drift toward generic SaaS gray.
- **Fraunces for display and email bodies only.** It's a personality font used selectively; all UI chrome is Inter.
- **Use `white-space: pre-wrap` for email paragraphs** so pasted content preserves line breaks.
- **Cap long-form reading measure.** Email reader content is capped at 780px; matter overview summaries at similar widths. Don't let body copy stretch full-width on wide monitors.
- **The Gmail sync metadata in the email drawer is a strong visual signal.** Keep the monospace formatting — it reads as "power user" without being intimidating.

---

## Open questions for the dev team

- Target platform (web / iOS / Electron)?
- Real backend — are you using the Gmail API directly, or a middleware (Nylas, Front, Missive-style sync)?
- IOLTA integration — is there a real trust accounting API, or is this surfacing data from QuickBooks/LeanLaw/Clio?
- Auth model — SSO? Firm-wide OAuth to Gmail?
- Matter-tagging model — are labels stored in Gmail or in your own metadata layer?

Answer these before wiring the data layer. The UI is ready regardless.
