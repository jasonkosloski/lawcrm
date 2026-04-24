# Feature Roadmap

Status legend: `[ ]` planned · `[~]` in progress · `[x]` complete · `[-]` descoped/deferred

---

## Phase 1 — App Shell & Core Navigation

- [x] **Project scaffold** — Next.js, shadcn, Prisma, TanStack Query
- [x] **Design tokens** — Brand colors, fonts, spacing from design handoff
- [x] **App shell** — Sidebar nav, topbar, layout wrapper
- [x] **Dashboard page** — KPI tiles, agenda, activity feed, deadlines, firm pulse (live Prisma queries)
- [x] **Seed data** — Populate DB with realistic mock data from the prototype
- [ ] **Command palette (⌘K)** — Fuzzy search matters, people, docs; run commands
- [x] **Sidebar: data-driven** — All sidebar content is live: per-user pinned matters (cuid hrefs), practice-area counts, main nav badges (open matters, unread email, active leads, hours today), current user profile
- [-] **Sidebar: sync status bar** — Removed entirely (was design chrome with no real signal behind it)
- [-] **Sidebar: notification bell** — Removed entirely (same reasoning as sync bar — no notification system to back it). Will re-appear when the Phase 8 Notifications feature exists.

## Phase 2 — Matters

- [x] **Matters list — route + basic table** — Route, table, real data, click-through to detail
- [x] **Matters list — sort & filter** — URL-backed state, 8 filter dimensions (search, area, stage, lead, fee, trust, deadline, status flags), sortable column headers with asc/desc/clear cycle
- [ ] **Matters list — view toggles** — Kanban and Cards views (table is done; kanban/cards are the "multiple ways to view" variants)
- [x] **Matter detail — pin toggle** — Per-user pin/unpin button in the header, server action + revalidation, sidebar updates live
- [~] **Matter detail — Overview tab** — Case facts + team roster done; deadlines preview, timeline preview, strategy note preview still to come
- [ ] **Matter detail — Timeline tab** — Chronological activity feed for a single matter (placeholder route exists)
- [ ] **Matter detail — Documents tab** — Document table with category filters (placeholder route exists)
- [ ] **Matter detail — Parties tab** — Contacts linked to this matter with roles (placeholder route exists)
- [ ] **Matter detail — Deadlines tab** — Deadline management with auto-rule support (placeholder route exists)
- [ ] **Matter detail — Tasks tab** — Task checklist with assignees and due dates (placeholder route exists)
- [ ] **Matter detail — Notes tab** — Rich text notes and strategy memos (placeholder route exists)
- [ ] **Matter detail — Billing tab** — WIP, time entries, invoices for this matter (placeholder route exists)
- [ ] **New matter form** — Create matter with stage, area, client, team assignment

## Phase 3 — Intake

- [ ] **Intake queue** — Split view: lead list + detail panel
- [ ] **Lead scoring** — Score display, liability/damages breakdown
- [ ] **Lead detail** — Summary, conflict check, statute window, conversion flow
- [ ] **Convert lead to matter** — Wizard that creates matter + runs automations

## Phase 4 — Email

- [ ] **Email inbox — three-pane layout** — Mailboxes, thread list, reader
- [ ] **Thread list** — Search, filter pills (All/Unread/Unfiled/Attach), selected state
- [ ] **Thread reader** — Accordion messages, attachments, reply stub
- [ ] **Email details drawer** — Participants, matter link, actions, sync metadata
- [ ] **Compose window** — Docked/expanded/minimized modes, matter picker, templates
- [ ] **Matter email filing** — File threads to matters, auto-filing suggestions
- [ ] **Gmail integration** — OAuth, thread sync, label management

## Phase 5 — Calendar & Time

- [ ] **Calendar view** — Week/month toggle, per-matter color coding, deadline markers
- [ ] **Calendar event create/edit** — Matter picker, attendees, video link
- [ ] **Time tracking — week view** — Hour bars per matter, running totals
- [ ] **Time entry modal** — Duration modes, UTBMS codes, narrative, billing toggles
- [ ] **Timer widget** — Floating bottom-right, start/stop, auto-capture from activity
- [ ] **Time reconciliation** — Day view with logged/captured/timer lanes

## Phase 6 — Billing & Trust

- [ ] **Invoices list** — Status chips, aging, totals
- [ ] **Invoice detail/generation** — Line items from time entries, PDF generation
- [ ] **Trust ledger** — IOLTA balance by matter, transactions, reconciliation
- [ ] **Settlement distribution** — Gross → fees → costs → liens → client net waterfall
- [ ] **Lien management** — Negotiation tracking, approval workflow
- [ ] **Financial reports** — AR/AP, realization %, collection rate

## Phase 7 — Contacts & Documents

- [ ] **Contact directory** — Type filters, search, matter associations
- [ ] **Contact detail** — Profile, linked matters, communication history
- [ ] **Document management** — Folder tree, file grid, category filters
- [ ] **Evidence viewer** — Multi-track timeline, flagged moments, transcript sync

## Phase 8 — Firm & Admin

- [x] **Settings — route framework** — `/settings` layout with left-rail section nav (Account group: Profile / Security / Notifications; Firm group: Team / Firm info / Integrations / Billing & rates). Each section has a dedicated route so features plug in a home as they land.
- [~] **Settings — Profile** — Read-only view of current user (name, role, initials). Edit form + server action pending Phase 9 auth.
- [ ] **Settings — Security** — Change password, 2FA, active sessions, sign-in history (blocked on Phase 9 Authentication)
- [ ] **Settings — Team management** — User roster, invite, role assignment, deactivate/reactivate (blocked on Phase 9 Authentication)
- [ ] **Settings — Firm info** — Firm name/address/logo, default practice areas, default fee structure, matter numbering scheme
- [ ] **Settings — Integrations** — Per-integration connection status + OAuth flows (Gmail, Google Calendar, Westlaw, e-sign, IOLTA bank feed, PACER). Each lights up when its underlying feature phase lands.
- [ ] **Settings — Billing & rates** — Default hourly rate, UTBMS code library, invoice templates, payment terms (blocked on Phase 6 Billing)
- [ ] **Automations** — Template library, trigger configuration
- [ ] **Reports** — Pipeline, utilization, financials dashboards
- [ ] **Role-based & customizable sidebar** — Different sidebar content per role, with per-user overrides. Attorneys see pinned matters; a finance user might pin reports or trust accounts; an intake paralegal might pin leads. Each role ships a sensible default, and users can add/remove/reorder pinned items from their own view. Depends on auth (for session user + role) and likely a `UserPreferences` model for persisted overrides. Consider a generic "pinned items" concept that spans matters, reports, leads, contacts, and views (saved filter URLs) rather than matter-only pinning.
- [ ] **Notifications** — Firm-wide notification system: new filings, email from opposing counsel, approaching deadlines, task assignments, settlement approvals. Needs a `Notification` model (user, type, target, read state, createdAt), a subscription/preference model per user, real-time delivery (SSE or WebSocket), a bell icon in the sidebar with unread count, and a notifications center page. Bell was removed from the sidebar until this feature exists — restore it as part of this work.

## Phase 9 — Polish & Production

- [ ] **Keyboard shortcuts** — Full shortcut system (`g d`, `g m`, `c` compose, etc.)
- [ ] **Responsive design** — Sidebar collapse on narrow viewports
- [ ] **Loading states** — Skeletons for all data-dependent views
- [ ] **Error boundaries** — Graceful error handling per route segment
- [ ] **Authentication** — Login, session management, role-based access
- [ ] **Deployment** — PostgreSQL, environment config, CI/CD

---

## Notes

- Phases are roughly ordered by dependency and value delivery, but we'll adjust based on priorities.
- Each feature should be built end-to-end (schema → API → UI) before moving to the next.
- Schema will evolve — see SCHEMA_NOTES.md for data model decisions per feature.
