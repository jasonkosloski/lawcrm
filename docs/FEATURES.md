# Feature Roadmap

Status legend: `[ ]` planned · `[~]` in progress · `[x]` complete · `[-]` descoped/deferred

---

## Phase 1 — App Shell & Core Navigation

- [x] **Project scaffold** — Next.js, shadcn, Prisma, TanStack Query
- [x] **Design tokens** — Brand colors, fonts, spacing from design handoff
- [x] **App shell** — Sidebar nav, topbar, layout wrapper
- [x] **Dashboard page** — KPI tiles, agenda, activity feed, deadlines, firm pulse (live Prisma queries)
- [x] **Seed data** — Populate DB with realistic mock data from the prototype
- [~] **Command palette (⌘K)** — Global ⌘K/Ctrl+K opens the palette from anywhere. Unified search across matters (name/case number/client/area/stage), contacts, leads, users, and navigation destinations. Contextual "Pin/Unpin this matter" action on matter detail pages. Recents persisted in localStorage; empty state shows recents + pinned matters + suggestions. Deferred to v2: scoping prefixes (@/#/>), create-new actions from palette, fuzzy-match highlight inside results.
- [x] **Sidebar: data-driven** — All sidebar content is live: per-user pinned matters (cuid hrefs), practice-area counts, main nav badges (open matters, unread email, active leads, hours today), current user profile
- [-] **Sidebar: sync status bar** — Removed entirely (was design chrome with no real signal behind it)
- [-] **Sidebar: notification bell** — Removed entirely (same reasoning as sync bar — no notification system to back it). Will re-appear when the Phase 8 Notifications feature exists.

## Phase 2 — Matters

> **Scope note:** Each matter-detail tab (Parties, Deadlines, Tasks, Notes,
> Documents, Timeline, Billing) is its own substantial feature area, not a
> single line item. The entries below mark "tab exists and renders real
> data" — follow-up work on create/edit flows, specialized UI (rich text
> for Notes, drag-drop for Tasks, document preview/upload for Documents,
> real-time aggregation for Timeline), in-tab search/filter, and
> integrations (OCR, deadline auto-generation, conflict checks) all
> belong to their own dedicated phases. Each tab will likely get its own
> Phase 2.X expansion once the v1 pass is complete.

- [x] **Matters list — route + basic table** — Route, table, real data, click-through to detail
- [x] **Matters list — sort & filter** — URL-backed state, 8 filter dimensions (search, area, stage, lead, fee, trust, deadline, status flags), sortable column headers with asc/desc/clear cycle
- [x] **Matters list — view toggle (Table / Kanban)** — Segmented control in topbar, URL-backed (`?view=kanban`), kanban shows all 10 lifecycle stages as columns (empty stages visible so pipeline shape stays legible), matter cards show area, fee, lead, trust, next-deadline; drag-drop between columns deferred to v2
- [ ] **Matters list — Cards view** — Visual grid view as a third view mode
- [x] **Matter detail — pin toggle** — Per-user pin/unpin button in the header, server action + revalidation, sidebar updates live
- [x] **Matter detail — Overview tab** — Case facts + team roster, plus preview cards (upcoming deadlines, open tasks, strategy note) that link through to their dedicated tabs
- [ ] **Matter detail — Timeline tab** — Chronological activity feed aggregating filings, emails, evidence, deadlines, notes, time entries (placeholder route exists)
- [x] **Matter detail — Documents tab** — Grouped by category (Filings / Pleadings / Discovery / Expert reports / etc.) with source + status chips
- [x] **Matter detail — Parties tab** — Grouped by role (Plaintiff / Defendant / Witness / Expert / Opposing counsel / etc.) with conflict flag indicator
- [x] **Matter detail — Deadlines tab** — Table with due date, days remaining, kind (critical / auto-rule / manual), source (statute / scheduling order / rule), owner, status; overdue deadlines flagged in warn color
- [x] **Matter detail — Tasks tab** — Grouped by status (Open / In progress / In review / Done / Cancelled) with priority chip, due date, owner
- [x] **Matter detail — Notes tab** — Card list with type chip (Note / Strategy / Chatter / Memo), author avatar, timestamp; pinned notes float to top
- [x] **Matter detail — Events tab** — Calendar events linked to this matter split into Upcoming / Past with time, type chip, location, attendee count; clicking opens the same EventDetailModal as the calendar page via `?event=<id>`
- [x] **Matter detail — Communication tab** — Email threads filed to this matter via `EmailThread.matterId`; embedded thread list links through to the main inbox with the thread preselected
- [ ] **Matter detail — Billing tab** — WIP, time entries, invoices for this matter (placeholder route exists)
- [~] **New matter form — v1** — Working first-pass form at `/matters/new` with fields (name, practice area, stage, case number, case location, fee structure, opposing party/firm, court, summary, lead attorney), typeahead client picker that defaults to creating a new Contact inline, and auto-populated matter name built from the hardcoded firm pattern (`Last, First - Case Number - Location`) with dirty-tracking + "Reset to auto" restore. Zod validation, inline errors via `useActionState`, server action creates Matter + MatterTeamMember (lead) + optional UserMatterPin + optional new Contact in a single write.

  > **Note: this form needs much more work.** The v1 gets the basic create flow working with a nice auto-name feel, but it's far from what a production legal-CRM intake flow should be. Expected follow-ups, non-exhaustive:
  >
  > - **Matter-name pattern as firm setting**: configurable by firm admin; per-practice-area overrides (§1983 might want incident date, Class might want plaintiff count, Trust might want decedent name)
  > - **Case location as a real schema field** (currently consumed only for name generation — not persisted)
  > - **Multi-member team assignment**: lead + paralegal + investigator + of-counsel with roles, with suggestions based on practice area
  > - **Tag from existing lead**: "Convert from…" button that pre-fills everything from a Lead row + runs the lead-to-matter conversion flow (schema: `Lead.convertedMatterId`)
  > - **Practice-area automations on create**: §1983 spawns a CGIA notice deadline + task; FHA spawns a HUD response deadline; CADA starts the 90-day EEOC right-to-sue clock; etc.
  > - **Document upload at intake**: engagement letter, client ID, initial evidence — upload during creation
  > - **Conflict check**: auto-run against existing Contacts + opposing parties before allowing save
  > - **Filed/trial date pickers** with scheduling-order import
  > - **Initial deadline templates** per practice area
  > - **Fee + retainer structure**: contingent fee %, retainer amount, trust deposit at intake
  > - **Multi-plaintiff matters**: allow linking additional clients beyond the primary
  > - **Client co-creation of address + DOB + SSN** (sensitive — needs encryption-at-rest discussion first)
  > - **Save draft and resume**: mid-intake interruptions shouldn't lose work
  > - **Mobile-responsive layout**: field density and flow on tablets during client meetings
  > - **Richer validation**: case number format check per court, duplicate-matter warning when same client + similar area, statute-of-limitations sanity check against date of incident
  > - **Real-form component library consolidation**: swap native `<select>` for shadcn Select once there's a pattern we like across the app

## Phase 3 — Intake

> **Scope note:** Like the matter-detail tabs, each intake feature is
> a substantial area — expect iterative depth per feature (lead scoring
> deep-dive with liability/damages breakdown, conflict-check automation
> against contacts+matters, conversion wizard that creates matter + runs
> automations, split-view reader pane, etc.). The entries below mark
> "v1 pass shipped" — follow-ups continue.

- [x] **Intake queue — v1 list** — Sortable-looking table, active leads surface first by score desc, score/assessment/statute/conflict/stage/age columns
- [x] **Lead detail — v1 page** — Case summary, assessment bars (liability + damages), contact card, intake meta, conflict-check card, converted-matter link when applicable; Convert / Decline actions placeholder until the conversion wizard ships
- [x] **Lead detail — tab structure + Communication tab** — Intake detail split into Overview + Communication tabs (matches matter-detail pattern); Communication tab matches threads by the lead's email address (sender, to, or cc). When lead↔thread linkage tightens (e.g., auto-match on inbound email), swap the query without changing the page.
- [ ] **Intake queue — split-view reader pane** — Lead list on the left, detail on the right (alternative to separate routes)
- [ ] **Lead scoring — deep dive** — Score composition, liability/damages factor breakdown, recompute on field changes
- [ ] **Conflict check automation** — Name/organization matching against existing Contacts and opposing parties with severity levels
- [ ] **Decline lead** — Inline stage change with decline reason capture
- [ ] **Convert lead to matter** — Wizard that creates matter + runs area-specific automations (CGIA notice for §1983, HUD response for FHA, etc.)

## Phase 4 — Communication

Unified inbox for everything the firm sends and receives on behalf of
clients: email, text messages, and (later) voicemail. Starts email-
first since that's where the existing schema lives, but the route and
page chrome are built under `/communication` so SMS can plug in without
a rename later. Schema currently uses `Email*` models; when SMS lands
we'll decide whether to add sibling `Sms*` models or generalize to
polymorphic `Communication*` — captured as an open question in
SCHEMA_NOTES.

- [ ] **Inbox — three-pane layout** — Channels/mailboxes, thread list, reader
- [ ] **Thread list** — Search, filter pills (All/Unread/Unfiled/Attach), channel filter (Email / SMS), selected state
- [ ] **Thread reader** — Accordion messages, attachments, reply stub; channel-aware (email formatting vs SMS bubbles)
- [ ] **Details drawer** — Participants, matter link, actions, sync metadata
- [ ] **Compose window** — Docked/expanded/minimized modes, matter picker, templates, channel picker (Email / SMS)
- [ ] **Matter filing** — File threads to matters, auto-filing suggestions
- [ ] **Gmail integration** — OAuth, thread sync, label management
- [ ] **SMS integration** — Likely Twilio for sending/receiving texts, with per-matter phone numbers
- [ ] **Voicemail transcription** — Later, when we wire phone integration

## Phase 5 — Calendar & Time

- [x] **Calendar — Week view** — 7 day columns with hour grid 6am–9pm, events positioned by start/end time, deadlines as thin bars at top of day, "now" line in today's column, events colored by matter
- [x] **Calendar — Month view** — 6-row grid, events as compact pills with time + title, deadlines styled distinctly by kind (critical / auto-rule / manual), +N more overflow indicator, today highlighted
- [x] **Calendar — navigation** — Prev/Today/Next buttons (week or month units depending on view), URL-driven state (`?view=week|month&d=YYYY-MM-DD`)
- [ ] **Calendar — Day view** — Single-day focus mode (deferred)
- [ ] **Calendar — Deadlines-only filter** — Hide events and show just upcoming deadlines (deferred)
- [ ] **Calendar event create/edit** — Placeholder route exists; real form is Phase 5 follow-up (title + type, start/end + all-day, matter picker, location/Zoom, attendees)
- [ ] **Calendar event — click to open detail** — Currently events colored/linked to matters; dedicated event detail is a follow-up
- [ ] **Google Calendar sync** — OAuth + two-way sync (deferred to integration phase)
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
