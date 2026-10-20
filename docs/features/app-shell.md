# App shell, dashboard, navigation

App shell (sidebar, topbar, layout), the dashboard with customizable cards, the Cmd+K command palette, loading/error states and the mobile sweep are shipped. Open work is dashboard drag/resize, the rest of palette v2, and the role-based sidebar.
Related: [ADR-055](../decisions/055-ui-system-v2-legibility-floor-and-colour-on-meaning.md) (UI system v2), [ADR-002](../decisions/002-app-router-route-groups-for-layout-isolation.md), [ADR-003](../decisions/003-design-tokens-as-css-custom-properties-not.md), [ADR-033](../decisions/033-error-boundaries-use-retry-the-notification-bell.md), [ADR-021](../decisions/021-matter-tabs-honour-calendar-visibility-and-money.md)

## Open work
- [ ] **Dark theme** (P3): v2 tokens make it a token-only change (`:root[data-theme=dark]` values); not started.
- [ ] **Matter tabs regroup** (P2, needs a product call): 13 tabs; Events + Deadlines + Tasks could become one "Schedule" tab. Workflow change, not styling.
- [ ] **Dashboard customizable layout — v3 (drag + resize)** (P2) — drag-to-reorder, per-card width control, role-based defaults tying into the customizable sidebar work.
- [~] **Command palette — v2** (P2) — scoping prefixes and Create group shipped (below). Remaining: fuzzy-match highlight inside results; "New task" (no standalone create page yet); "Log a call" (CallLogDialog needs contact-picker data plus a URL affordance to auto-open); "Start timer" (`startTimer()` now refuses with `already_running` instead of replacing a running session, so the row could be added by surfacing that refusal).
- [ ] **Role-based & customizable sidebar** (P2) — different sidebar content per role with per-user overrides. Generic "pinned items" concept spanning matters, reports, leads, contacts, saved-filter URLs. Depends on auth (shipped) plus a `UserPreferences` model.

## Shipped
- [x] **UI system v2** (2026-10-20, ADR-055) — 11px floor and a 12/13/14 ramp, contrast-safe ink tiers, `font-mono` as tabular Inter, text-safe status colours; neutral ink chrome (sidebar pill, underline tabs, no gradients or tinted tiles); `StatStrip` for headline figures and `DueLabel` for every due date; foldable practice-area group in the sidebar; the idle timer as an icon button. Patterns in UI_PATTERNS.
- [x] **Project scaffold** — Next.js, shadcn, Prisma, TanStack Query (the query package is installed but unused; mutations are server actions).
- [x] **Design tokens** — brand colors, fonts, spacing from the design handoff (ADR-003).
- [x] **App shell** — sidebar nav, topbar, layout wrapper.
- [x] **Seed data** — realistic mock data from the prototype.
- [x] **Dashboard page** — KPI tiles, agenda, your tasks, activity feed, deadlines, firm pulse (live Prisma queries). Definitions:
  - "Hours today" is the viewer's OWN hours.
  - Email KPIs and follow-ups are per-mailbox; the "flagged" sub-KPI means starred + unread in your own mailbox.
  - A/R = client invoices sent/partial outstanding; collection rate = collected / billed over client sent/partial/paid.
  - Today's agenda uses the calendar Busy scrub and lists all-day events first as "All day".
  - The Deadlines card lists overdue rows ("Nd late") across all non-archived matters (max 20) with matter links.
  - Your tasks shows at most 25 per bucket plus "+N more"; its row menu has only Log time / Add note (not the full matter-tab task menu).
  - Dashboard queries take the viewer's timezone.
- [x] **Dashboard goals instead of magic numbers** (2026-07-07) — `Firm.dailyHoursGoal` (default 6.0) and `Firm.monthlyBillableGoal` (default 200) replace the old constants. Dashboard KPIs and firm pulse read them via `getFirmGoals()` (`src/lib/firm.ts`); the /time day view gets the goal from its page. Editable on /settings/firm (Goals section, gated `firm.edit_info`; validated positive, one decimal, <=24 daily / <=744 monthly). Possible refinement: per-USER daily-target overrides.
- [x] **Dashboard customizable layout — v1 show/hide** — "Customize" popover in the dashboard topbar, one checkbox per card. Persisted as JSON on `User.dashboardPrefs`. Defaults to all visible, so new cards auto-appear without backfill. Optimistic UI flip + server action + revalidation.
- [x] **Dashboard customizable layout — v2 reorder** (2026-07-07) — up/down arrows per row in the popover, grouped by column (main vs right rail; cards keep a fixed column). `order: cardKey[]` is persisted alongside `visible`; `mergeOrder` mirrors `mergeVisibility` (unknown keys dropped, dupes deduped, new cards appended in default order). Hidden cards stay listed/orderable and keep their slot when re-shown. Order is sent whole from the client and sanitized server-side (`setDashboardCardOrder`); the visibility action rewrites both halves of the blob so neither clobbers the other.
- [x] **Command palette (Cmd+K)** — opens from anywhere. Unified search across matters (name/case number/client/area/stage), contacts, leads, users and navigation destinations. Contextual "Pin/Unpin this matter" on matter pages. Recents in localStorage; empty state shows recents, pinned matters and suggestions. Token-AND filter so multi-word queries match across fields.
  - **v2:** scoping prefixes (`#matter`, `@person` incl. leads, `>action`) parsed by `src/components/command-palette/prefix.ts` and enforced in the cmdk filter via per-item kind tags. "Create" group (New matter, New contact, New event) is pure navigation; target pages enforce their own permission gates because PaletteData carries no permission flags (`/matters/new` now does). Reports row is permission-gated; the palette is lazy-loaded. "Search everywhere" carries `#`/`@` into `/search?type=matter|contact` and hides under `>`.
  - Note: the "New intake / lead" row was removed while `/intake/new` did not exist and is back now that it ships.
- [x] **Sidebar — data-driven** — per-user pinned matters (cuid hrefs), practice-area counts, main nav badges (open matters, unread email in own mailbox unarchived only, active leads, hours today). No firm-level Billing item (no such page); Automations lives under Settings.
- [x] **Loading states** — `loading.tsx` per high-traffic segment (dashboard, matters list, matter detail, intake, calendar, communication, contacts) backed by shared `<PageSkeleton variant="tiles|table|detail|grid">`.
- [x] **Error boundaries** — dashboard-segment `error.tsx`, `not-found.tsx` for missing matters/leads/contacts, root `global-error.tsx` as last resort (ADR-033).
- [x] **Mobile / responsive sweep** (2026-06, `feat(responsive)` commit series) — drawer sidebar + hamburger topbar shell, then per-surface passes: dashboard, matters list + detail, calendar (week view, toolbar, agenda rail, all-day row), intake, contacts, communication (mailbox drawer, reader header reflow), matter billing, forms/modals/settings.
