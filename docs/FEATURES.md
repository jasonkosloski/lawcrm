# Feature Roadmap

Single source of truth for what's shipped, what's in flight, and
what's left. Updated as work lands.

Status legend: `[ ]` planned · `[~]` in progress · `[x]` complete · `[-]` descoped/deferred

---

## Where we are

**Past MVP feature-completeness.** A solo lawyer can run a practice
on what's shipped today: intake → matter → time → billing → trust →
settlement, with calendar, deadlines, tasks, notes, documents,
contacts, communication (read), audit log, and granular permissions.
Authentication is real (Auth.js + argon2id). Production deploy is
on Postgres (Vercel Postgres) with the build wired to regenerate the
Prisma client.

The remaining work clusters around three buckets:

1. **External integrations** — Gmail send/OAuth, Google Calendar
   sync, SMS (Twilio), voicemail. Each unblocks a real workflow that
   today reads-only or requires a side trip out of the app.
   (Token encryption-at-rest — the OAuth prerequisite — is done.)
2. **Big polish** — document templates, reports dashboard
   (mobile/responsive sweep shipped 2026-06).
3. **Tech debt + consistency** — date format sweep, magic numbers
   into settings, status string literals, EmptyState component.

Most "P0/P1 missing features" from the prior MVP punch-list are now
done. What's left is enumerated below.

---

## Remaining work (priority-ordered)

### P0 — production-ready blockers

- [ ] **Gmail OAuth + email send / reply / file-to-matter.** The
  Communication tab is read-only today (`src/app/(dashboard)/communication/page.tsx`).
  The single biggest broken promise of the app — a "unified inbox"
  you can't send from. Needs the OAuth flow, two-way sync, compose
  window, reply, and a "file thread to matter" action.

### P1 — usability + governance

- [~] **Phone call / SMS / voicemail logging.** Manual "Log a call"
  v1 shipped (see Phase 4 in Shipped) — contact + direction +
  outcome + duration + summary + optional matter filing, stored as
  a `MessengerItem` so it renders inline in the Messages view. The
  matter-detail Communication tab now has an Email | Phone channel
  toggle: the Phone channel lists the matter's filed calls/texts/
  voicemails and hosts a matter-scoped Log-call composer. Edit /
  delete of manual logs shipped (kebab on manual call items in the
  thread reader + matter phone log; provider-synced items stay
  immutable), as did the lead-page "Log call" entry point (contact
  pre-selected, files matterless) and the contact-page entry point
  (contact fixed via `fixedContact`). Still left: SMS send
  (Quo / Twilio), voicemail transcription — both need providers.
- [ ] **Document templates / template library.** No way to save and
  reuse a demand letter, discovery responses, retainer agreement.
- [ ] **Search results page + global text search.** ⌘K palette
  covers narrow lookups. No results page, no save-search, no
  within-list keyword search beyond the matter list filters.
- [~] **Notifications — finish out.** v1 shipped (Notification model,
  bell + popover, mark-read, fan-out helpers, triggers for team-add
  and invoice-payment). Still left: deadline-approaching cron,
  task-assigned trigger (TaskOwner edits), settlement-step approver
  fan-out, email/SMS/push delivery channels, `/notifications` full
  feed page.
- [ ] **Calendar event create — v2.** Standalone `/calendar/events/new`
  full form with matter picker, attendees + RSVP statuses, all-day
  toggle (already in edit), recurrence rules. Today: per-matter
  EventComposer + the inline NewEventComposer cover the common case.
- [ ] **Calendar — Day view.** Single-day focus mode (deferred from
  Phase 5).
- [ ] **Calendar — Deadlines-only filter.** Hide events and show
  just upcoming deadlines.
- [ ] **Google Calendar sync.** OAuth + two-way sync.
- [ ] **Time tracking — week view.** Hour bars per matter, running
  totals.
- [ ] **Time entry modal — UTBMS codes, narrative, billing toggles,
  duration modes.**
- [ ] **Timer widget.** Floating bottom-right, start/stop, auto-
  capture from activity.
- [ ] **Time reconciliation.** Day view with logged/captured/timer
  lanes.
- [~] **Standalone Contact UI v2.** Shipped 2026-07-07: granular
  `contacts.*` permission gates, multi-phone management UI
  (add/remove/relabel/reorder/set-primary with server-enforced
  invariants), conflict-flag control with required justification →
  activity log, and contact merge (`contacts.merge`) — one
  transaction re-points every reference (matter links with
  duplicate-row dedupe, client-of, leads, messenger threads,
  attendees, invoices), moves + dedupes phones, backfills null
  scalars, soft-retires the loser with `mergedIntoId` redirect.
  Still left: bulk operations.

### P2 — polish + tech debt

- [ ] **Reports dashboard.** Pipeline, utilization, AR aging,
  realization rate. Deferred to its own sprint.
- [~] **Date format sweep.** Done except communication/intake/
  contacts surfaces (owned by parallel work streams — thread-list,
  follow-up-button, comm-time-logged-indicator, messenger/thread
  readers, intake pages still on ad-hoc formatting). Everything
  else funnels through `formatDate`/`formatRelative` variants;
  dashboard queries take the viewer's TZ (`getTodayAgenda`,
  `getMyOpenTasks`, `getUpcomingDeadlines`, `getDashboardKpis`,
  `getFirmPulse`, `getFollowUpsDueToday`, `getRecentActivity`);
  date-only inputs parse via `parseLocalDate` (see ADR-012).
  `ui/calendar.tsx` (vendored react-day-picker) left alone.
- [ ] **No timezone awareness in date pickers.** When users in
  different cities enter "March 15", browser TZ may save it as a
  different day. Fix: standardize on a `formatDateInTz` helper +
  ISO date inputs, not Date objects.
- [ ] **Hardcoded magic numbers in dashboard.** `pulse.billableGoal
  = 200`, `hoursGoal = 6.0` in `src/lib/queries/dashboard.ts`.
  Should come from FirmSettings or UserSettings.
- [ ] **`/matters/[id]/intake/[id]/time` is a placeholder.** Doesn't
  render anything meaningful. Either build it or remove the route.
- [ ] **Status / priority / role values are scattered string
  literals.** `"open"`, `"in_progress"`, `"urgent"`, `"lead"`,
  `"paralegal"`, etc. live in dozens of files. Typos would silently
  misclassify rows. Centralize as TS const unions in
  `src/lib/constants/`.
- [ ] **No shared `<EmptyState>` component.** Every page invents
  its own. Extract one with a consistent treatment + optional CTA.
- [ ] **Plurals are hardcoded.** "1 matters" / "1 deadlines"
  appear in places that don't compute the singular. Small
  `plural(n, "matter")` helper.
- [ ] **PracticeArea color vs Matter color drift.** Matter snapshots
  area color on create; if the area color changes, matters keep the
  old color. Document the decision in DECISIONS.md (or fix).
- [ ] **Email labels render as raw `privileged_label` instead of
  "Privileged".** Label-formatter helper.
- [ ] **Inconsistent button sizes** across cards / tables / forms.
  Define a per-context size convention and sweep once.
- [ ] **No HTML sanitization on user-entered text** (matter
  description). `whitespace-pre-wrap` renders raw. Stored XSS risk
  if multi-user / external email ever pipes content in. Note bodies
  are already DOMPurified server-side.
- [ ] **`NoteRead` table will grow unbounded.** No cleanup when a
  note is deleted or archived. Cascade-delete on Note delete;
  periodic cleanup job once row counts matter.
- [ ] **Document versioning.** No version field on Document. Will
  matter the second a draft pleading goes through 3+ revisions.
- [ ] **Evidence viewer.** `Evidence`, `FlaggedMoment`,
  `EvidenceSync` schemas are designed for body-cam / dashcam
  timelines (§1983 use case) but no UI exists. Defer.
- [ ] **Document management — folder tree, file grid, category
  filters.** Today the matter Documents tab covers per-matter; a
  firm-wide library is the next step.
- [ ] **Dashboard customizable layout — v2 (reorder).** Up/down
  arrow controls in the customize popover. Persist `order: cardKey[]`
  alongside `visible` in `User.dashboardPrefs`.
- [ ] **Dashboard customizable layout — v3 (drag + resize).**
  Drag-to-reorder, per-card width control, role-based defaults
  tying into the customizable sidebar work.
- [ ] **Command palette — v2.** Scoping prefixes (`@person`,
  `#matter`, `>action`), create-new actions ("New matter", "New
  task", etc.), fuzzy-match highlight inside results.
- [ ] **Role-based & customizable sidebar.** Different sidebar
  content per role with per-user overrides. Generic "pinned items"
  concept spanning matters, reports, leads, contacts, saved-filter
  URLs. Depends on auth (shipped) + a `UserPreferences` model.
- [ ] **Automations.** Template library, trigger configuration.
  Phase 8 placeholder.
- [ ] **Export / print to PDF — beyond invoices.** Invoices ✓ (chrome-
  free `/print/invoices/[id]` route, browser Save-as-PDF). Demand
  letters + trust reports still pending.
- [ ] **Settings — Security.** Change password, 2FA, active
  sessions, sign-in history. Blocked on Auth Phase 2 (see
  `docs/AUTH_PLAN.md`).
- [ ] **Settings — Integrations.** Per-integration connection
  status + OAuth flows (Gmail, Google Calendar, Westlaw, e-sign,
  IOLTA bank feed, PACER). Each lights up when its underlying
  feature phase lands.
- [ ] **Settings — Billing & rates.** Default hourly rate, UTBMS
  code library, invoice templates, payment terms.
- [ ] **Lead → matter conversion — v2 automations.** Practice-area
  -specific automations: §1983 spawns a CGIA notice deadline +
  task; FHA spawns a HUD response deadline; CADA starts the 90-day
  EEOC right-to-sue clock. Plus initial deadline templates per
  area.
- [ ] **`/matters/new` v2 follow-ups.** Matter-name pattern as firm
  setting (per-area overrides), case location as a real schema
  field, multi-member team assignment, tag-from-existing-lead,
  practice-area automations on create, document upload at intake,
  conflict check pre-save, filed/trial date pickers, initial
  deadline templates, retainer + trust deposit at intake, multi-
  plaintiff matters, sensitive-field encryption (DOB/SSN), save-
  draft-and-resume, mobile layout, richer validation, real-form
  component library consolidation. (See the v1 entry under "Shipped"
  for context.)
- [ ] **Intake queue — split-view reader pane.** Lead list on left,
  detail on right (alternative to separate routes).
- [ ] **Lead scoring — deep dive.** Score composition, liability/
  damages factor breakdown, recompute on field changes.
- [ ] **Matters list — Cards view.** Visual grid as a third view
  mode (today: Table + Kanban).
- [ ] **Calendar — visibility v2.** A user can opt to view another
  user's calendar (with the visibility resolver still in force —
  they only see what they'd see anyway from the timeline view).
  Foundation already in place.

---

## Shipped

Organized by phase for context. Each entry is a "feature ships
end-to-end" milestone — schema, action, query, UI all wired.

### Phase 1 — App shell & core navigation

- [x] **Project scaffold** — Next.js, shadcn, Prisma, TanStack Query
- [x] **Design tokens** — Brand colors, fonts, spacing from design handoff
- [x] **App shell** — Sidebar nav, topbar, layout wrapper
- [x] **Dashboard page** — KPI tiles, agenda, your tasks, activity feed, deadlines, firm pulse (live Prisma queries)
- [x] **Dashboard — customizable layout (v1: show/hide)** — "Customize" popover in the dashboard topbar with one checkbox per card. Persisted as JSON on `User.dashboardPrefs` (`{ visible: Record<cardKey, boolean> }`). Defaults to all visible — new cards auto-appear without backfill. Optimistic UI flip + server action + revalidation.
- [x] **Seed data** — Realistic mock data from the prototype
- [x] **Command palette (⌘K)** — Global ⌘K opens the palette from anywhere. Unified search across matters (name/case number/client/area/stage), contacts, leads, users, and navigation destinations. Contextual "Pin/Unpin this matter" action on matter detail pages. Recents persisted in localStorage; empty state shows recents + pinned matters + suggestions. Token-AND filter so multi-word queries match across fields.
- [x] **Sidebar — data-driven** — All sidebar content is live: per-user pinned matters (cuid hrefs), practice-area counts, main nav badges (open matters, unread email, active leads, hours today), current user profile.
- [x] **Loading states** — `loading.tsx` per high-traffic segment (dashboard, matters list, matter detail, intake, calendar, communication, contacts) backed by a shared `<PageSkeleton variant="tiles|table|detail|grid">`.
- [x] **Error boundaries** — Dashboard-segment `error.tsx` + `not-found.tsx` for missing matters/leads/contacts + root `global-error.tsx` as last-resort fallback.

### Phase 2 — Matters

> **Scope note:** Each matter-detail tab (Parties, Deadlines, Tasks,
> Notes, Documents, Timeline, Billing) is its own substantial feature
> area, not a single line item. The entries below mark "tab exists
> and renders real data" — follow-up work on create/edit flows,
> specialized UI (rich text for Notes, drag-drop for Tasks, document
> preview/upload for Documents, real-time aggregation for Timeline),
> in-tab search/filter, and integrations (OCR, deadline auto-
> generation, conflict checks) belong to their own dedicated phases.

- [x] **Matters list — route + basic table** — Route, table, real data, click-through to detail.
- [x] **Matters list — sort & filter** — URL-backed state, 8 filter dimensions, sortable column headers.
- [x] **Matters list — view toggle (Table / Kanban)** — Segmented control, URL-backed (`?view=kanban`), kanban shows all 10 lifecycle stages; matter cards show area/fee/lead/trust/next-deadline.
- [x] **Matter detail — pin toggle** — Per-user pin/unpin, server action + revalidation, sidebar updates live.
- [x] **Matter detail — Overview tab** — Case facts + team roster (active in brand color; former dimmed with "(former)" suffix), preview cards for upcoming deadlines, open tasks, all pinned notes rendered as rich-text HTML, Clients card with contact info.
- [x] **Matter team management** — Admin-gated section on matter edit page: add/remove lead/co-counsel/paralegal/investigator/of-counsel. Promoting a lead auto-demotes existing one to co-counsel. Removal soft (`MatterTeamMember.removedAt`); former members render dimmed. At-least-one-lead invariant. ActivityLog on every add/remove. Permission key: `matters.manage_team`.
- [x] **Matter detail — Timeline tab** — Real chronological activity feed reading from `ActivityLog`. Day-grouped (Today/Yesterday/absolute date) with per-row icon, source chip, author, timestamp. URL-driven filter pills (All/Filings/Communications/Deadlines/Tasks/Notes/Time/Financial/Events) with live counts. 200-row cap.
- [x] **Matter detail — Documents tab** — Grouped by category. Real upload UI (file picker + display-name override + category dropdown, 25 MB max). Per-row download + delete (admin or original uploader). Files stored under `./uploads/` via a pluggable `src/lib/file-storage.ts` adapter — swap to Vercel Blob / S3 by changing one file. Downloads gated end-to-end via `/api/documents/[id]/download`.
- [x] **Matter detail — Parties tab** — Grouped by role (Plaintiff / Defendant / Witness / Expert / Opposing counsel / etc.). Every party is a first-class `Contact` (link to `/contacts/[id]`); representing attorneys also via `MatterContact.representationContactId`.
- [x] **Matter detail — Deadlines tab** — Table with due date, days remaining, kind, source, owner, status. Overdue flagged in warn color. Per-row kebab: Edit dialog + Set status (open/completed/waived) + Delete. Stage transition guard (terminal → non-terminal reopens, backward jumps > 1 stage) requires confirmation.
- [x] **Matter detail — Tasks tab** — Grouped by status (Open / In progress / In review / Done / Cancelled) with priority chip, due date, owner. Inline status toggle, per-row kebab (Edit + Log time + Add note + Convert to deadline + Set status + Delete). Same affordances on dashboard "Your tasks" card.
- [x] **Matter detail — Notes tab** — Card list with type chip (Note/Strategy/Chatter/Memo), author avatar, timestamp; pinned notes float to top. Tiptap rich-text editor (`@tiptap/react`); HTML output sanitized server-side via DOMPurify on insert.
- [x] **Matter detail — Events tab** — Calendar events linked to this matter, split into Upcoming / Past with time, type chip, location, attendee count. Clicking opens the EventDetailModal (same as the calendar page) via `?event=<id>`.
- [x] **Matter detail — Communication tab** — Email threads filed via `EmailThread.matterId`; embedded thread list links through to the main inbox.
- [x] **Matter detail — Billing tab (v1)** — Three-card KPI strip (WIP, Trust, Outstanding AR) + invoices table + WIP entries + trust ledger + matter-level Received-payments ledger. **Generate invoice from WIP** (auto YYYY-NNN numbering, 30-day terms). **Bundle as internal record** for contingency / pro-bono closes (kind="internal_record", born paid, excluded from AR). **Client invoice state machine** (draft → approved → sent → partial → paid; void only with no payments; drafts deletable). **Send invoice** dialog with channel + recipient + optional trust application. **Apply trust** shortcut for outstanding-balance + trust-funded matters. **Record payment** (check/ACH/cash/card/other/trust) with default-checked "Send updated invoice to client". Trust composer with overdraw prevention. Letterhead-style preview pane. **PDF export** via chrome-free `/print/invoices/[id]?autoprint=1`. **Line-item editing** (Pencil icon on Services rows; refused once `sent`; gates on `time_entries.edit_any` for non-authors).
- [x] **Settlement waterfall (v1)** — Settlement card on the Billing tab. Composer captures gross / firm fee % / advanced costs / status (pending → approved → disbursed → closed). Lien composer with negotiated/effective amounts (strikethrough on original when negotiated). 4-step approval chain (Client release / Liens / Partner sign-off / Trust reconciliation). Auto-promote to approved when all steps approved. Granular permissions: `matters.settlement.{view,edit,manage_liens,approve}`.
- [x] **Matter expenses (v1)** — First-class `Expense` model. Composer + table on the Time & Expenses tab. Granular permissions (`matters.expense.{view,create,edit,delete}`). Edit/delete refused once billed. **Invoice integration** — `generateInvoiceFromWip` and `bundleAsInternalRecord` sweep both buckets (time + billable expenses) into the subtotal. **Receipt attachment** — composer surfaces a receipt picker linked via `Expense.receiptDocumentId`; cross-matter isolation enforced server-side.
- [~] **New matter form — v1** — Working `/matters/new` with full intake fields, typeahead client picker (defaults to inline new Contact), auto-populated matter name (`Last, First - Case Number - Location`) with dirty-tracking + "Reset to auto" restore. Single-write Matter + MatterTeamMember + optional UserMatterPin + optional new Contact. **v2 follow-ups in remaining-work.**
- [x] **Stage transition guard** — Server returns `requiresConfirmation` for terminal → non-terminal reopens and backward jumps > 1 stage; UI surfaces the warning + retries with `force: true` on confirm. Distinctive ActivityLog title for reopens.
- [x] **Statute-of-limitations tracking** — `Matter.incidentDate` + `PracticeArea.statutePeriodDays` + `statuteSourceCitation`. Practice-area edit form takes years/months/days inputs (packed into total days, 365/30/d). Matter create + update auto-populate `statuteOfLimitationsDate` from `incidentDate + area.statutePeriodDays` (explicit SOL date wins). Mirrors into a `kind="critical"` Deadline row via `syncMatterSolDeadline`; create/update/satisfied-flip keep both sides synced.

### Phase 3 — Intake

> **Scope note:** Like the matter-detail tabs, each intake feature
> is a substantial area. Iterative depth per feature is expected.

- [x] **Intake queue — v1 list** — Sortable table; active leads first by score desc.
- [x] **Lead detail — v1 page** — Case summary, assessment bars (liability + damages), contact card, intake meta, conflict-check card, converted-matter link.
- [x] **Lead detail — tab structure + Communication tab** — Overview + Communication. Communication tab is contact-scoped (joined `Lead.contact`) and surfaces email threads + SMS/call/voicemail threads. Picks up Contact edits automatically.
- [x] **Lead → Contact integration** — Every lead hangs off a first-class Contact via `Lead.contactId`. Conversion reuses the existing Contact instead of creating fresh.
- [x] **Conflict check automation (v1)** — Pure matcher in `src/lib/conflict-check.ts`. Email match → conflict if contact appears as opposing-side; else warn. Severity: clear/warn/conflict. `runLeadConflictCheck` persists status + timestamp; `overrideLeadConflictCheck` flips warn/conflict to "override" with required 5+ char justification. Permissions: `intake.conflict_check.{run,override}`. Audit-logged.
- [x] **Decline lead** — Topbar action with optional internal reason; flips `Lead.stage` to "declined" and bounces the lead from the active queue.
- [x] **Convert lead to matter — v1** — Topbar action with practice area + initial stage + matter name + fee structure. Single-transaction creates Matter + Contact (or reuses one matching the lead's email) + MatterTeamMember + UserMatterPin. Lead summary/location/incident date/injuries/source flow into Matter.description.

### Phase 4 — Communication (read-only today)

The unified inbox lives at `/communication` (route reserved so SMS
plugs in without a rename). Currently read-only — see remaining
work for Gmail OAuth + send.

- [x] **Manual call logging — v1** — "Log call" button on the
  Messages view (thread-list header). Composer: contact typeahead
  (auto-fills phone, editable / required when none on file),
  direction, outcome (answered/missed/no answer), date-time,
  duration (answered only), optional matter + summary. Action
  `logCall` writes a `kind="call"` `MessengerItem` (providerEventId
  `manual-<uuid>`) into the contact's thread — reuses the firm's
  first active MessengerAccount or bootstraps a `provider="manual"`
  one, normalizes phone to E.164, backfills `thread.contactId`,
  advances `lastItemAt` without regressing. Call summaries now
  render under the call chip in the thread reader. Activity-log
  type `"call"` (Phone icon; Timeline "Communications" filter
  includes it). Permission: `communication.log_call`.
- [x] **Manual call log edit / delete** — kebab menu on manually
  logged call items (thread reader + matter Phone channel; gated by
  `communication.edit_call` / `communication.delete_call`, item
  flagged via the `manual-` providerEventId prefix →
  `MessengerItemRow.isManual`). Edit reuses the log-call composer
  (`CallLogDialog` edit mode) prefilled — outcome, direction,
  when, duration, summary, matter re-file; contact + phone are
  fixed (thread identity). `updateCallLog` / `deleteCallLog` refuse
  provider-synced items (immutable records), recompute
  `thread.lastItemAt` from surviving items, and delete the thread
  when its last item goes (threads re-create on demand by
  (account, phone) key). Spawned time entries / tasks / notes
  survive a delete with their FK nulled. "Log call" also mounts on
  the lead Communication tab with the lead's contact pre-selected
  (no matter — conversion creates it).
- [x] **Matter-detail Phone channel** — Email | Phone segmented
  toggle on the matter Communication tab (`?channel=phone`,
  URL-driven). Phone channel lists every call / text / voicemail
  filed to the matter (directly or via thread default routing —
  `listMessengerItemsForMatter`), newest first, linking to the full
  reader. Hosts the Log-call composer with the matter pre-selected
  (no picker) and the matter's client + parties floated to the top
  of the contact typeahead.
- [x] **Thread read tracking** — Opening a thread now marks it read
  (previously unread badges were permanent). `markEmailThreadRead` /
  `markMessengerThreadRead` in `src/app/actions/thread-read.ts` —
  session-gated like notifications (read-state is viewing-inherent,
  no catalog key), transactional flip of item flags + the
  denormalized `MessengerThread.unreadCount` (heals counter drift),
  no-op + no revalidation when already read. Fired by an invisible
  `MarkThreadRead` island mounted in both thread readers.
- [x] **Missed-call detection — status-based** — Thread list rows
  flag missed calls from the raw `MessengerItem.callStatus`
  (`lastCallStatus` on `MessengerThreadRow`) via the shared
  `isMissedCall` predicate (inbound + missed/no_answer/declined;
  busy/failed render neutrally), replacing the old
  `lastBody === "Missed call"` string heuristic.

### Phase 5 — Calendar & Time

- [x] **Calendar — Week view** — 7 day columns with hour grid 6am–9pm; events positioned by start/end; deadlines as thin bars; "now" line in today's column; events colored by matter.
- [x] **Calendar — Month view** — 6-row grid; events as compact pills with time + title; deadlines styled by kind; +N more overflow indicator; today highlighted.
- [x] **Calendar — navigation** — Prev/Today/Next (week or month units); URL-driven (`?view=week|month&d=YYYY-MM-DD`).
- [x] **Calendar event — full create + edit + delete + drag-and-drop** — Real edit form at `/calendar/events/[eventId]/edit` (title/type/start/end/location/Zoom/description/matter assignment/delete). All-day toggle (datetime ↔ date inputs). Attendee picker (typed: users + contacts + new). Drag-and-drop reschedule (week-view chips drag to time slots; preserves duration when timed; default 2h when promoting from all-day). Generic DnD utilities at `src/lib/dnd/` so the same primitives feed the future kanban. Action `moveCalendarEvent` gated on `events.edit`. Standalone `NewEventComposer` for the calendar's "+ New event" button creates matterless / personal events.
- [x] **Calendar event — visibility model** — Per-event + per-user visibility resolver. Default-deny with five unlock paths (creator, attendee, matter team, per-event override, creator's user-default). Server-side strip (`getCalendarItems` + `getCalendarEventById` scrub title/location/description/zoomUrl/matter/attendees and use neutral color when locked). New permission `events.edit_non_matter` gates editing other users' personal events. Min-firm-attendee invariant (every event keeps ≥1 firm-user attendee; creator auto-added as fallback). UI: per-user "Default event visibility" radio on `/settings/profile`; per-event toggle on edit modal + standalone NewEventComposer + matter-detail EventComposer.
- [x] **Calendar — auto-attendee defaults** — `Firm.autoAddTeamToNewEvents` + per-matter override. New events on a matter optionally pull in the matter team as accepted attendees automatically. Adding a new team member optionally fans them out across upcoming matter events (past untouched).

### Phase 7 — Contacts & Documents

- [x] **Contact directory** — `/contacts` with URL-driven search + per-type filter pills (Client/Opposing counsel/Witness/Expert/etc.). Detail page (profile + linked matters split into "as client" + "as party"). Full create + edit + soft-delete (isActive=false to preserve historical matter rows). `Contact.phone` stays in sync with the primary `ContactPhone` row. Wired into sidebar primary nav + command palette.

### Phase 8 — Firm & Admin

- [x] **Settings — route framework** — `/settings` layout with left-rail section nav (Account: Profile/Security/Notifications; Firm: Team/Firm info/Integrations/Billing & rates).
- [x] **Settings — Profile** — Self-edit form (name/initials/phone/bar number/avatar URL/time zone/default event visibility). Right rail surfaces identity + governance read-only (email, role, admin badge, active status, member-since, firm) with a chip pointing to /settings/team.
- [x] **Settings — Team** — Firm-scoped roster (admins float to top, then active alphabetically). Admins get per-row kebab (Edit / Reset password) + "Invite member" composer. At-least-one-Admin invariant. Can't-deactivate-yourself. Unique-email-on-invite. Reset-password and invite generate a one-time temp password the admin delivers out-of-band (replaced by magic-link when delivery lands — see `docs/AUTH_PLAN.md` Phase 2).
- [x] **Settings — Activity log** — Cross-matter audit page at `/settings/activity` reading from `ActivityLog`. URL-driven filter pills + user dropdown + from/to date inputs. Gated on `firm.view_activity`. 200-row cap.
- [x] **Settings — Roles** — First-class permission roles (`Admin` short-circuits everything; `default` auto-assigned). Custom roles get whatever the matrix grants. **Permissions matrix** lets users with `firm.manage_permissions` toggle which permissions each role grants — Y-axis is every permission key (grouped by category), X-axis is every role, intersection is a checkbox. Admin column rendered checked + locked. Runtime checks in `src/lib/permission-check.ts`. Full reference at `docs/PERMISSIONS.md`.
- [x] **Settings — Firm info** — First-class `Firm` model (name/short name/EIN/website/phone/email/address/country/established date/logo URL). Users with `firm.edit_info` get an inline edit form; everyone else read-only. Right rail shows team count + admin list.
- [x] **Settings routes gated end-to-end on permission keys** — `/settings/practice-areas` (+ `[id]`) gates on `firm.manage_practice_areas`; `/settings/integrations` + `/settings/billing` use `firm.edit_info` as a placeholder; `/settings/activity` gates on `firm.view_activity`. Settings nav hides any entry the user can't see.
- [x] **Practice area + stage editing** — `/settings/practice-areas/[id]` has full stage CRUD: create stage, rename, mark/unmark terminal, reorder up/down, archive (refused if any active matters still sit in the stage). All gated on `firm.manage_practice_areas`.
- [x] **Notifications — v1 (in-app)** — `Notification` model (per-user, per-event row, `readAt` for unread state, optional matter scope). Writer helpers `createNotification` / `createNotifications` (fan-out + dedup) in `src/lib/notifications.ts` mirror the `logActivity` fire-and-forget contract. Topbar `NotificationBell` self-fetches every 60s + on dropdown open. Mark-one-read on row click; mark-all-read on header link. Per-user scoping in the action so a guessed id can't flip another user's row. Triggers wired today: matter team add (notifies the new member), invoice payment recorded (fans out to matter team minus actor). See "remaining work" for the rest.

### Phase 9 — Polish & Production

- [x] **Mobile / responsive sweep** — Drawer sidebar + hamburger
  topbar shell, then per-surface passes: dashboard, matters list +
  detail, calendar (week view, toolbar, agenda rail, all-day row),
  intake, contacts, communication (mailbox drawer + reader header
  reflow), matter billing, forms/modals/settings. Landed 2026-06
  across the `feat(responsive)` commit series.
- [x] **Email token encryption-at-rest** — `EmailAccount.accessToken`
  / `refreshToken` encrypt with AES-256-GCM via a Prisma query
  extension on the singleton client; key from `EMAIL_TOKEN_KEY`
  (base64 32 bytes, per-environment). Versioned wire format
  (`v1:<iv>:<tag>:<ciphertext>`) for future rotation. The Gmail
  OAuth prerequisite. See ADR-011 + `src/lib/email-token-crypto.ts`
  / `src/lib/email-token-encryption.ts`.
- [~] **Authentication — Phase 1 (email + password, JWT sessions)** — Auth.js v5 + Prisma adapter + argon2id. `/login` page with generic error messages (no email enumeration), `?next=` round-trip via `src/proxy.ts`, sign-out from the sidebar profile strip. `Account` + `VerificationToken` tables provisioned for OAuth/password-reset later. **Phase 2** (MFA, OAuth, password reset, session revocation) deferred — see `docs/AUTH_PLAN.md`.
- [x] **Database — production Postgres** — `prisma/schema.prisma` provider is `postgresql`; production runs on Vercel Postgres (POSTGRES_PRISMA_URL → DATABASE_URL pooled, POSTGRES_URL_NON_POOLING → DIRECT_DATABASE_URL direct). Build wired (`prisma generate && next build` + `postinstall: prisma generate`). Tests run against a local Docker container (`docker-compose.test.yml`); integration setup waits for the DB, pushes the schema, runs each test against a fresh state via `resetDb()` in `beforeEach`.

---

## Notes

- Phases are roughly ordered by dependency and value delivery, but
  we adjust based on priorities. The current shape is heavy on
  Phases 1–3 + 5 + 7 + 8 (most done), light on Phase 4 (read-only
  inbox until Gmail lands) and Phase 6 (financial reports).
- Each feature should be built end-to-end (schema → API → UI) before
  moving to the next.
- Schema evolves — see `SCHEMA_NOTES.md` for data model decisions
  per feature.
- Decisions worth preserving (architectural, security,
  product-shape) live in `DECISIONS.md`.
