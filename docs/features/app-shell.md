# App shell, dashboard, navigation

App shell (sidebar, topbar, layout), the dashboard with customizable cards, the Cmd+K command palette, loading/error states and the mobile sweep are shipped. Open work is dashboard triage cards and role defaults, the rest of palette v2, and the role-based sidebar.
Related: [ADR-002](../decisions/002-app-router-route-groups-for-layout-isolation.md), [ADR-003](../decisions/003-design-tokens-as-css-custom-properties-not.md), [ADR-033](../decisions/033-error-boundaries-use-retry-the-notification-bell.md), [ADR-021](../decisions/021-matter-tabs-honour-calendar-visibility-and-money.md)

## Open work
- [ ] **Dashboard sub-project 2 — "Needs me now" triage card + new cards** (P2) — triage card plus pinned matters, time-this-week chart, new leads, unbilled time, upcoming SOLs.
- [ ] **Dashboard sub-project 3 — role default layouts** (P2) — `Role.dashboardLayout` (the one schema change), editor in Settings → Roles, "reset to role default"; multi-role users take the first role in a defined priority order.
- [ ] **Dashboard drag collision follow-up** (P3) — drag uses `closestCorners`; a drop near a column's top can resolve to the zone (append) instead of the column slot. Verify in browser QA.
- [~] **Command palette — v2** (P2) — scoping prefixes and Create group shipped (below). Remaining: fuzzy-match highlight inside results; "New task" (no standalone create page yet); "Log a call" (CallLogDialog needs contact-picker data plus a URL affordance to auto-open); "Start timer" (`startTimer()` now refuses with `already_running` instead of replacing a running session, so the row could be added by surfacing that refusal).
- [ ] **Role-based & customizable sidebar** (P2) — different sidebar content per role with per-user overrides. Generic "pinned items" concept spanning matters, reports, leads, contacts, saved-filter URLs. Depends on auth (shipped) plus a `UserPreferences` model.

## Shipped
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
- [x] **Dashboard customizable layout — v3** — layout is a full-width band plus 1–3 columns (splits 8/4, 4/8, 6/6, 4/4/4, 12), stored as v3 JSON on `User.dashboardPrefs`; v1/v2 blobs convert on read (no migration), so existing users see the same dashboard and new cards auto-appear. In-place Customize mode: drag cards (pointer, touch, keyboard via @dnd-kit) between band and columns, split picker, hidden-cards tray, Reset to default, Cancel/Done with one save on Done. Below `lg` it becomes a list editor (up/down, zone select, hide). In edit mode, cards missing for permission show "Not available for your role" and restored hidden cards show "Shown after you save". One file per card in `src/components/dashboard/cards/` on the shared `DashboardCard` frame; "View all" links only where a page exists (agenda, deadlines, follow-ups, activity with `firm.view_activity`); greeting line shows "N due today".
- [x] **Command palette (Cmd+K)** — opens from anywhere. Unified search across matters (name/case number/client/area/stage), contacts, leads, users and navigation destinations. Contextual "Pin/Unpin this matter" on matter pages. Recents in localStorage; empty state shows recents, pinned matters and suggestions. Token-AND filter so multi-word queries match across fields.
  - **v2:** scoping prefixes (`#matter`, `@person` incl. leads, `>action`) parsed by `src/components/command-palette/prefix.ts` and enforced in the cmdk filter via per-item kind tags. "Create" group (New matter, New contact, New event) is pure navigation; target pages enforce their own permission gates because PaletteData carries no permission flags (`/matters/new` now does). Reports row is permission-gated; the palette is lazy-loaded. "Search everywhere" carries `#`/`@` into `/search?type=matter|contact` and hides under `>`.
  - Note: the "New intake / lead" row was removed while `/intake/new` did not exist and is back now that it ships.
- [x] **Sidebar — data-driven** — per-user pinned matters (cuid hrefs), practice-area counts, main nav badges (open matters, unread email in own mailbox unarchived only, active leads, hours today). No firm-level Billing item (no such page); Automations lives under Settings.
- [x] **Loading states** — `loading.tsx` per high-traffic segment (dashboard, matters list, matter detail, intake, calendar, communication, contacts) backed by shared `<PageSkeleton variant="tiles|table|detail|grid">`.
- [x] **Error boundaries** — dashboard-segment `error.tsx`, `not-found.tsx` for missing matters/leads/contacts, root `global-error.tsx` as last resort (ADR-033).
- [x] **Mobile / responsive sweep** (2026-06, `feat(responsive)` commit series) — drawer sidebar + hamburger topbar shell, then per-surface passes: dashboard, matters list + detail, calendar (week view, toolbar, agenda rail, all-day row), intake, contacts, communication (mailbox drawer, reader header reflow), matter billing, forms/modals/settings.
