# Feature Roadmap

Status legend: `[ ]` planned · `[~]` in progress · `[x]` complete · `[-]` descoped/deferred

---

## Phase 1 — App Shell & Core Navigation

- [x] **Project scaffold** — Next.js, shadcn, Prisma, TanStack Query
- [x] **Design tokens** — Brand colors, fonts, spacing from design handoff
- [x] **App shell** — Sidebar nav, topbar, layout wrapper
- [x] **Dashboard page** — KPI tiles, agenda, your tasks, activity feed, deadlines, firm pulse (live Prisma queries)
- [x] **Dashboard — customizable layout (v1: show/hide)** — "Customize" popover in the dashboard topbar with one checkbox per card (KPIs, Today's agenda, Your tasks, Recent activity, Deadlines, Firm pulse). Persisted as a JSON blob on `User.dashboardPrefs` (shape: `{ visible: Record<cardKey, boolean> }`). Defaults to everything visible — new cards added later auto-appear without a backfill. Optimistic UI flip + server action + revalidation. Works for solo today; multi-user-correct once Phase 9 auth lands without code changes.
- [ ] **Dashboard — customizable layout (v2: reorder)** — Up/down arrow controls in the customize popover to reorder cards. Persist `order: cardKey[]` alongside `visible` in `User.dashboardPrefs`. Render order driven by the prefs, not the source file.
- [ ] **Dashboard — customizable layout (v3: drag + resize)** — Drag-to-reorder within the popover (or directly on the dashboard with a "rearrange" mode), per-card width control (full-width vs sidebar), maybe role-based defaults that tie into the Phase 8 customizable sidebar work.
- [x] **Seed data** — Populate DB with realistic mock data from the prototype
- [x] **Command palette (⌘K)** — Global ⌘K/Ctrl+K opens the palette from anywhere. Unified search across matters (name/case number/client/area/stage), contacts, leads, users, and navigation destinations. Contextual "Pin/Unpin this matter" action on matter detail pages. Recents persisted in localStorage; empty state shows recents + pinned matters + suggestions. Token-AND filter so multi-word queries match across fields.
- [ ] **Command palette — v2** — Scoping prefixes (`@person`, `#matter`, `>action`), create-new actions from the palette ("New matter", "New task", "New event", etc.), fuzzy-match highlight inside results, contact-detail navigation once `/contacts` exists.
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
- [x] **Matter detail — Overview tab** — Case facts + team roster (active members surfaced in brand color; former members stay listed but dimmed with a "(former)" suffix for historical attribution), plus preview cards (upcoming deadlines, open tasks, **all pinned notes** rendered as rich-text HTML matching the Notes tab) that link through to their dedicated tabs
- [x] **Matter team management** — Admin-gated section on the matter edit page lets admins add and remove team members (lead, co-counsel, paralegal, investigator, of-counsel). Add picks from any active firm member and choosing role=`lead` automatically demotes the existing lead to co-counsel (humane swap, not an off-team kick). Remove is soft: `MatterTeamMember.removedAt` flips on, the row stays for audit, and the overview roster labels them "(former)". Re-adding a former member upserts the existing row so there's still one row per user-matter relationship. Refuses to remove the last lead without first promoting another member. Every add/remove writes an `ActivityLog` entry so the matter audit trail captures who-changed-what. Permission model is admin-only today; the path is set up to swap in firm-configurable role permissions when those land.
- [x] **Matter detail — Timeline tab** — Real chronological activity feed reading from `ActivityLog`. Every action that creates a Note / Task / Deadline / TimeEntry / CalendarEvent / Document / Invoice transition / Stage transition / Team change / Permission grant writes a row; the Timeline surfaces them grouped by day (Today / Yesterday / absolute date) with a per-row icon, source chip, author, and timestamp. URL-driven filter pills (All / Filings / Communications / Deadlines / Tasks / Notes / Time / Financial / Events) with live counts that dim when empty. Cap at 200 most-recent events for now; archive viewer for older entries is a follow-up. Pin-to-Overview, date-range scrubber, and PDF export are deferred.
- [x] **Matter detail — Documents tab** — Grouped by category (Filings / Pleadings / Discovery / Expert reports / etc.) with source + status chips. Real upload UI now: inline composer with file picker + display-name override + category dropdown (max 25 MB per file). Per-row download (PDFs preview inline; everything else streams) + delete (admin or original uploader). Files stored under `./uploads/` in dev via a pluggable `src/lib/file-storage.ts` adapter — swap to Vercel Blob / S3 in prod by changing one file. Downloads gated end-to-end via `/api/documents/[id]/download` so the auth boundary stays in the app, not the storage backend.
- [x] **Matter detail — Parties tab** — Grouped by role (Plaintiff / Defendant / Witness / Expert / Opposing counsel / etc.) with conflict flag indicator. Every party is a first-class `Contact` (link to `/contacts/[id]`); the representing attorney on each non-client party is also a `Contact` via `MatterContact.representationContactId`, so repeat counsel coalesces across matters and the rep cell deep-links into the contact directory.
- [x] **Matter detail — Deadlines tab** — Table with due date, days remaining, kind (critical / auto-rule / manual), source (statute / scheduling order / rule), owner, status; overdue deadlines flagged in warn color. Per-row kebab menu with Edit dialog + Set status (open / completed / waived) + Delete. Overdue is computed from dueDate, not directly settable.
- [x] **Matter detail — Tasks tab** — Grouped by status (Open / In progress / In review / Done / Cancelled) with priority chip, due date, owner. Inline status toggle (click circle to mark done), per-row kebab menu with Edit dialog + Log time + Add note + Convert to deadline + Set status submenu + Delete. Attached notes render inline below the row. Same kebab affordances (Log time + Add note) appear on the dashboard "Your tasks" card so the user can act on a task without leaving home.
- [x] **Matter detail — Notes tab** — Card list with type chip (Note / Strategy / Chatter / Memo), author avatar, timestamp; pinned notes float to top
- [x] **Matter detail — Events tab** — Calendar events linked to this matter split into Upcoming / Past with time, type chip, location, attendee count; clicking opens the same EventDetailModal as the calendar page via `?event=<id>`
- [x] **Matter detail — Communication tab** — Email threads filed to this matter via `EmailThread.matterId`; embedded thread list links through to the main inbox with the thread preselected
- [x] **Matter detail — Billing tab (v1)** — Three-card KPI strip (WIP, Trust, Outstanding AR) + invoices table + WIP entries list + trust ledger + matter-level **Received payments** ledger. **Generate invoice from WIP** bundles every approved-and-unbilled time entry into a draft Invoice (auto YYYY-NNN numbering, 30-day default terms) and flips entries to `billed`. **Bundle as internal record** is the sibling action for contingency / pro-bono cases that close without a fee petition — same WIP-bundling mechanic, but the resulting Invoice has `kind="internal_record"` (born locked at status="paid" rendered as "Recorded"), is excluded from Outstanding AR, and the preview reads "Internal Record" / "For matter file" instead of "Invoice" / "Bill to". Reason captured into `Invoice.notes`. **Client invoice state machine** (draft → approved → sent → partial → paid; drafts are deletable, void allowed only on approved/sent rows with no payments recorded): **Delete draft** removes a draft entirely (kebab; client drafts only) — no audit row, time entries return to billable WIP. **Approve** flips draft to approved (one-click). **Send invoice** opens a dialog capturing channel (Email / US-mail-coming-soon), recipient (pre-filled from client.email, editable), and an optional "Apply $X from trust" checkbox; submitting transitions the invoice to sent (or partial / paid if the trust application covers the balance). Actual delivery is logged-only for now — Gmail integration + US-mail print/ship workflow are deferred. **Record payment** opens once an invoice is sent or partially paid: amount, method (check / ACH / cash / card / other / trust when matter has trust funds), date, reference, memo. Creates an `InvoicePayment` row; trust selections also write the four-leg trust ledger op atomically; status flips to `paid` when fully covered, `partial` otherwise. **Apply trust** is a dedicated shortcut button that surfaces whenever an invoice has an outstanding balance AND the matter has trust funds — opens a focused dialog defaulting the amount to MIN(trust, balance) and runs the same four-leg op (trust ledger + balance decrement + invoice paidAmount + payment record) atomically. Both manual-payment dialogs (Apply trust + Record payment) carry a default-checked **"Send updated invoice to client"** checkbox so the client always gets a refreshed copy reflecting the new payment activity (logged-only today; same flag will fire real email when integration lands). Disabled with a "no email on file" hint when the client record is missing an email; the future automatic-payment portal will record payments without this flag (its own confirmation flow handles client comms). The invoice preview surfaces every recorded payment in a "Payments received" section (date / source / description / reference / amount). The matter-level Received payments ledger shows every payment ever applied to any invoice on the matter (date / method / invoice link / reference / amount, with the lifetime total in the section header) — the matter-scoped slice of what will eventually be a firm-wide trust + operating ledger. Trust composer adds deposits / disbursements / refunds with overdraw prevention. Letterhead-style preview pane opens on the right when an invoice is selected (sticky top bar with state-aware action button + Void in a kebab + close). `Matter.billingMode` chip surfaces the matter's billing flow (Client / Court-appointed / Fee petition / None); inherited from `PracticeArea.defaultBillingMode` on create, overridable per-matter via the matter edit form. Non-client modes show a "flow not implemented yet" banner and route through the traditional UX until each per-mode flow lands. Decimal math throughout. Deferred to v2: invoice line-item editing, expense tracking, PDF export, real email/mail send, court-voucher submission packets, fee-petition court exhibits, settlement waterfall, tax calculation, aging report, role-based gating of approve/send (every signed-in firm user can do these today).
- [x] **Settlement waterfall (v1)** — Settlement card on the matter Billing tab. Composer captures gross / firm fee % / advanced costs / status (pending → approved → disbursed → closed). Lien composer adds medical / subrogation / Medicare-Medicaid liens with negotiable amounts; per-row UI strikes through the original when a negotiated amount is set. Read layer recomputes firm fee from percent + client net from the deduction stack on every render so the numbers stay coherent if a lien gets renegotiated. **4-step approval chain** seeded on create (Client release signed / Lien negotiations finalized / Partner sign-off / Trust ledger reconciliation): per-step Approve / Reject / Reset buttons + approver-name + timestamp + optional notes. Settlement auto-promotes to `approved` status when every step is approved (disbursement remains a separate explicit action). Approval buttons hide when settlement is disbursed/closed (chain locks). Granular permissions: `matters.settlement.view` / `.edit` / `.manage_liens` / `.approve`. Audit-log entry on every settlement + lien + step action. Deferred: printable distribution sheet, multi-settlement matters, custom step labels per firm.
- [x] **Matter expenses (v1)** — First-class `Expense` model + UI on the matter Time & Expenses tab. Composer logs cost / description / category / UTBMS code / billable + client-advanced flags / notes. Table renders date / description / category / UTBMS / amount / billing chip / logger. Billable + un-invoiced expenses surface as a "Billable" chip; once billed they link to the invoice. Edit refused once billed. Delete refused once billed (server enforces; UI hides the menu item). Granular permissions: `matters.expense.view` / `.create` / `.edit` / `.delete` — composer + delete kebab gate on the appropriate key. Audit-log entry on every create / edit / delete. **Invoice integration:** `generateInvoiceFromWip` and `bundleAsInternalRecord` now sweep both buckets (time entries + billable un-invoiced expenses) into the invoice subtotal in one transaction. Voiding an invoice unlinks both buckets so they're available for re-bundling. The invoice preview surfaces an "Expenses" section under "Services" when any expenses were bundled. **Receipt attachment:** the composer surfaces a receipt picker (when the matter has any documents) that links the expense to a Document via `Expense.receiptDocumentId`; the row carries a 📎 Receipt chip that opens the file in a new tab when a blob exists, or shows "Receipt (no file)" otherwise. Cross-matter isolation enforced server-side — a tampered FK silently coerces to null. Deferred: markup rules, lead-level expense logging.
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
- [x] **Lead detail — tab structure + Communication tab** — Intake detail split into Overview + Communication tabs (matches matter-detail pattern); Communication tab is now contact-scoped (joined `Lead.contact`) and surfaces both email threads (matching `displayEmail` as sender / to / cc) AND SMS / call / voicemail threads (scoped to `displayPhone`). When the joined Contact is edited (e.g. phone number changes on `/contacts/[id]`), the lead view picks it up automatically.
- [x] **Lead → Contact integration** — Every lead hangs off a first-class `Contact` via `Lead.contactId`, mirroring how `Matter.clientId` works. The Contact card on the lead Overview links through to the contact directory. Lead → Matter conversion reuses the existing Contact instead of creating a fresh one each time, so a person who contacts the firm twice surfaces as one record across the system.
- [ ] **Intake queue — split-view reader pane** — Lead list on the left, detail on the right (alternative to separate routes)
- [ ] **Lead scoring — deep dive** — Score composition, liability/damages factor breakdown, recompute on field changes
- [x] **Conflict check automation (v1)** — Pure matcher in `src/lib/conflict-check.ts` scans a lead's name/email/organization against existing Contacts (email match → conflict if the contact appears as opposing-side on any matter, else warn) and matter opposing-side records (legacy text fields + structured MatterContact non-client roles). Severity: clear / warn / conflict. The lead Overview page renders matches live (re-runs on every load) with deep-links into matched contact / matter rows. `runLeadConflictCheck` button persists status + timestamp; `overrideLeadConflictCheck` flips warn/conflict to "override" with a required 5+ char ethics-audit justification. Granular permissions: `intake.conflict_check.run` / `.override`. Audit-log entry on both actions. Bounded queries (200-row caps).
- [x] **Decline lead** — Topbar action opens a dialog capturing an optional internal reason; flips Lead.stage to "declined" and bounces the lead out of the active intake queue.
- [x] **Convert lead to matter — v1** — Topbar action opens a dialog asking for practice area + initial stage + matter name + fee structure. Single-transaction creates Matter + Contact (or reuses one matching the lead's email) + MatterTeamMember (lead) + UserMatterPin, then redirects to the new matter. Lead summary/location/incident date/injuries/source flow into Matter.description.
- [ ] **Convert lead to matter — v2 (automations)** — Practice-area-specific automations on convert: §1983 spawns a CGIA notice deadline + task; FHA spawns a HUD response deadline; CADA starts the 90-day EEOC right-to-sue clock. Plus initial deadline templates per area.

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
- [x] **Calendar event edit + delete** — Replaced the placeholder edit page with a real form (title + type, start/end datetime, location, zoom URL, description). Delete button on the event detail modal with confirm + redirect back to the calendar (or matter events tab). Create still happens via the existing EventComposer on the matter Events tab; a top-of-calendar "New event" full form + matter picker + attendee management is a v2 follow-up.
- [ ] **Calendar event create — v2** — Standalone /calendar/events/new full form with matter picker, attendees + RSVP statuses, all-day toggle, recurrence rules. (Today: per-matter EventComposer covers the common case.)
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

- [x] **Contact directory** — `/contacts` list with URL-driven search + per-type filter pills (Client / Opposing counsel / Witness / Expert / etc.), detail page (profile + linked matters split into "as client" + "as party"), full create + edit + soft-delete (isActive=false to preserve historical matter rows). Contact.phone stays in sync with the primary ContactPhone row. Wired into the sidebar primary nav and command palette.
- [ ] **Contact directory — v2** — Conflict-flag UI (today the field exists in schema but only set programmatically), contact merge for duplicates, bulk operations, multi-phone management UI per contact (today only the primary is editable inline).
- [ ] **Contact detail** — Profile, linked matters, communication history
- [ ] **Document management** — Folder tree, file grid, category filters
- [ ] **Evidence viewer** — Multi-track timeline, flagged moments, transcript sync

## Phase 8 — Firm & Admin

- [x] **Settings — route framework** — `/settings` layout with left-rail section nav (Account group: Profile / Security / Notifications; Firm group: Team / Firm info / Integrations / Billing & rates). Each section has a dedicated route so features plug in a home as they land.
- [x] **Settings — Profile** — Self-edit form for the current user (name, initials, phone, bar number, avatar URL). Right rail surfaces identity / governance fields read-only (email, role, admin badge, active status, member-since, firm) with a chip that points the user to /settings/team for the things only an admin can change. Includes a forwarder note to /settings/security for password changes (placeholder until that phase lands).
- [ ] **Settings — Security** — Change password, 2FA, active sessions, sign-in history (blocked on Phase 9 Authentication)
- [x] **Settings — Team** — Firm-scoped roster (admins float to the top, then active members alphabetically). Everyone sees the read-only list; admins get a kebab per row (Edit / Reset password) and an "Invite member" composer at the bottom. Roles are a multi-select tied to the firm's defined `Role` rows; the "default" role is auto-assigned and locked. Server-side invariants: at-least-one-Admin-role-holder (rejects role/active changes that would leave 0 admins), can't-deactivate-yourself, and unique-email-on-invite. Reset-password and invite each generate a one-time URL-safe temp password the admin delivers out-of-band — replaced by magic-link email when delivery lands (Phase 2 of `docs/AUTH_PLAN.md`).
- [x] **Settings — Activity log** — Cross-matter audit page at `/settings/activity` reading from `ActivityLog`. URL-driven filter pills (All / Filings / Communications / Deadlines / Tasks / Notes / Time / Financial / Events) plus a user dropdown + from/to date inputs that submit the form back to itself. Each row carries title, detail, source chip, matter deep-link (when scoped), author, and timestamp. Page is gated on `firm.view_activity`; the settings sidebar hides the link for users without it. Cap at 200 most-recent events; tighter filters surface older entries.
- [x] **Settings — Roles** — First-class permission roles. Every firm seeds with two system roles: `Admin` (short-circuits every permission check to true — anyone holding it can do anything) and `default` (auto-assigned to every member). Custom roles get whatever permissions the matrix grants them. **Permissions matrix** on the same page lets users with `firm.manage_permissions` toggle which permissions each role grants — Y-axis is every permission in the static catalog (grouped by category: Matters / Billing / Trust / Firm settings / Documents), X-axis is every role in the firm, intersection is a checkbox. Admin's column is rendered checked + locked. **Runtime checks live in `src/lib/permission-check.ts`** (`currentUserHasPermission(key)` for read-side / canEdit flags, `requirePermission(key)` for server-action gates) and are wired into every server action and page guard. Concrete gates: matter team adds/removes (`matters.manage_team`), firm-info edit (`firm.edit_info`), practice-area CRUD (`firm.manage_practice_areas`), team directory (`firm.manage_team_directory`), role CRUD (`firm.manage_roles`), permission-matrix toggles (`firm.manage_permissions`), document override-delete (`documents.delete_any`). Settings sidebar items hide for users without their `requires` permission. The v1 catalog has some coarse `manage_*` keys for backward compat with the prior admin-only flows; future feature work splits each capability into view / add / edit / delete keys per the granular-permissions guideline.
- [x] **Settings routes gated end-to-end on permission keys** — `/settings/practice-areas` (+ `[id]`) gates on `firm.manage_practice_areas`; `/settings/integrations` + `/settings/billing` use `firm.edit_info` as a placeholder until those features grow their own keys; `/settings/activity` gates on `firm.view_activity`. The settings nav hides any entry the user can't see. Practice-area + stage + invoice + team + role + permission CRUD actions all call `requirePermission(<key>)` as defense-in-depth (admin role short-circuits to all granted).
- [x] **Settings — Firm info** — First-class `Firm` model with name / short name / EIN / website / phone / email / address / country / established date / logo URL. Users holding `firm.edit_info` (admin always; other roles via the matrix) get an inline edit form; everyone else sees a read-only view (the EIN should be lookupable by every firm member). Right rail shows the team count + admin list. Future bits — logo upload, default fee structure, matter numbering scheme — land here as their feature phases ship.
- [ ] **Settings — Integrations** — Per-integration connection status + OAuth flows (Gmail, Google Calendar, Westlaw, e-sign, IOLTA bank feed, PACER). Each lights up when its underlying feature phase lands.
- [ ] **Settings — Billing & rates** — Default hourly rate, UTBMS code library, invoice templates, payment terms (blocked on Phase 6 Billing)
- [ ] **Automations** — Template library, trigger configuration
- [ ] **Reports** — Pipeline, utilization, financials dashboards
- [ ] **Role-based & customizable sidebar** — Different sidebar content per role, with per-user overrides. Attorneys see pinned matters; a finance user might pin reports or trust accounts; an intake paralegal might pin leads. Each role ships a sensible default, and users can add/remove/reorder pinned items from their own view. Depends on auth (for session user + role) and likely a `UserPreferences` model for persisted overrides. Consider a generic "pinned items" concept that spans matters, reports, leads, contacts, and views (saved filter URLs) rather than matter-only pinning.
- [ ] **Notifications** — Firm-wide notification system: new filings, email from opposing counsel, approaching deadlines, task assignments, settlement approvals. Needs a `Notification` model (user, type, target, read state, createdAt), a subscription/preference model per user, real-time delivery (SSE or WebSocket), a bell icon in the sidebar with unread count, and a notifications center page. Bell was removed from the sidebar until this feature exists — restore it as part of this work.

## Phase 9 — Polish & Production

- [ ] **Keyboard shortcuts** — Full shortcut system (`g d`, `g m`, `c` compose, etc.)
- [ ] **Responsive design** — Sidebar collapse on narrow viewports
- [x] **Loading states** — `loading.tsx` per high-traffic segment (dashboard, matters list, matter detail, intake, calendar, communication, contacts) backed by a shared `<PageSkeleton variant="tiles|table|detail|grid">` so layout doesn't jump on hydrate.
- [x] **Error boundaries** — Dashboard-segment `error.tsx` catches uncaught throws inside any /dashboard route and renders a friendly card with the message + a Try-again button. `not-found.tsx` for missing matters/leads/contacts. Root `global-error.tsx` as last-resort fallback when the root layout itself crashes.
- [~] **Authentication — Phase 1 (email + password, JWT sessions)** — Auth.js v5 + Prisma adapter + argon2id. `/login` page with generic error messages (no email enumeration), `?next=` round-trip via `src/proxy.ts`, sign-out from the sidebar profile strip. Seed users get a hashed dev password (`ChangeMe2026!`). `Account` + `VerificationToken` tables provisioned now so adding Google OAuth or password-reset flows later is config-only. Everything else (MFA, OAuth, password reset, RBAC, session revocation, account lockout, audit log) is deferred — see `docs/AUTH_PLAN.md`.
- [ ] **Deployment** — PostgreSQL, environment config, CI/CD

---

## Notes

- Phases are roughly ordered by dependency and value delivery, but we'll adjust based on priorities.
- Each feature should be built end-to-end (schema → API → UI) before moving to the next.
- Schema will evolve — see SCHEMA_NOTES.md for data model decisions per feature.
