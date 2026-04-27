# MVP To-Do

A brutally honest punch-list to get this CRM from "looks-like-an-app" to "a
solo lawyer can run their practice on it." Two sections:

1. **Missing features** — capabilities that don't exist yet
2. **Broken / janky** — capabilities that exist but don't work right

Each item has a priority (P0 = blocks MVP, P1 = MVP usability, P2 = polish)
and, where applicable, file paths so you can dive straight in.

Last full audit: 2026-04-27

> **Update — 2026-04-27:** Second sprint landed (billing flow refactor,
> permissions matrix, matter team management, payment recording,
> received-payments ledger, draft delete). The remaining P0 work is
> still mostly external-infra-blocked: Gmail OAuth, mobile sweep.
> Big P1 wins still on the list: Notifications model, expense
> tracking, conflict check automation, SOL automation, stage
> transition guard, rich-text note editor, activity log viewer,
> standalone Contact UI v2 (merge), practice-area stage editing.

---

## 1. Missing features for MVP

### P0 — cannot ship without these

- [ ] **Email send / reply / file-to-matter + Gmail OAuth.** Communication tab is read-only (`src/app/(dashboard)/communication/page.tsx`). The single biggest broken promise of this app — a "unified inbox" you can't send from. Needs OAuth flow, two-way sync, compose window, reply, and a "file thread to matter" action.
- [x] ~~**Contact directory.**~~ ✓ shipped. `/contacts` with search + per-type filter pills, detail page (profile + linked matters as client and as party), full create + edit + soft-delete. Wired into sidebar + command palette. Conflict-flag UI + merge are tracked as v2 in FEATURES.md.
- [x] ~~**Document upload & storage.**~~ ✓ shipped 2026-04-25. Real upload composer on the Documents tab (file picker + display name + category + 25 MB cap). Files write to `./uploads/` in dev via the pluggable `src/lib/file-storage.ts` adapter; production swaps in Vercel Blob / S3 by changing one file. Per-row download via auth-gated `/api/documents/[id]/download` (so the security boundary stays in the app, not the storage backend) + per-row delete (admin or original uploader). What's still deferred: drag-and-drop, multi-file upload in one go, inline preview beyond what the browser does for PDFs, document versioning.
- [x] ~~**Lead → matter conversion.**~~ ✓ shipped. Both buttons are real now: Decline opens a reason-capture dialog and flips the lead, Convert opens a practice-area + stage + matter-name + fee picker and creates Matter + Contact + team assignment + sidebar pin in one transaction. Lead summary/incident date/injuries flow into Matter.description. Practice-area-specific automations on convert (CGIA / HUD / EEOC) tracked as v2 in FEATURES.md.
- [~] **Invoice generation + trust ledger** (v1 shipped 2026-04-25, refactored 2026-04-27, PDF export + line-item editing added 2026-04-25). `/matters/[id]/billing` carries the full client invoice state machine (draft → approved → sent → partial → paid; void only with no payments; drafts deletable). Send dialog with optional trust application; Apply trust shortcut; Record payment with multi-channel support (check / ACH / cash / card / other / trust). Notify-client checkbox on every payment surface. Matter-level Received payments ledger. Decimal math throughout. **PDF export ✓** — Print button on every invoice surface routes to `/print/invoices/[id]?autoprint=1`, auto-fires the browser's print dialog (Save as PDF built in). **Line-item editing ✓** — Pencil icon on each Services row in the preview pane opens an edit dialog (date / activity / narrative / hours / rate; amount auto-computed). Action `updateInvoiceLineItem` only allows edits while invoice is `draft` or `approved`; refused once `sent`. Authors edit their own; non-authors gate on `time_entries.edit_any`. Invoice subtotal + total recompute in the same transaction. **Still deferred:** real email/mail delivery (Gmail integration blocks), tax calculation, AR firm-wide page, recurring invoices, payment-gateway integration.
- [ ] **Mobile / responsive layout.** Sidebar doesn't collapse, calendar + matters table assume desktop width, no breakpoints anywhere. Field work — depositions, court appearances, client meetings — is impossible on iPad/iPhone.

### P1 — MVP usability

- [~] **Calendar event create/edit form.** v1 ✓ shipped — full edit page at `/calendar/events/[eventId]/edit` with `EditEventForm` covering title, type, start/end, location, Zoom URL, description, matter assignment + delete with confirm + redirect back to the calendar. Still deferred: all-day toggle (schema field exists), attendee picker (CalendarAttendee model exists), recurrence rules (RRULE expansion is a multi-day feature).
- [x] ~~**Expense tracking.**~~ ✓ shipped 2026-04-27 + 2026-04-25. First-class `Expense` model, composer + table on the matter Time & Expenses tab, granular `matters.expense.{view,create,edit,delete}` permissions in the matrix, soft refusal of edit/delete once an expense has been billed onto an invoice, audit-log on every action. **Rolls into invoice generation ✓** — `generateInvoiceFromWip` pulls billable time + billable expenses in one transaction, sums both into the invoice subtotal, and stamps `Expense.invoiceId` on each. Void unlinks both buckets. The invoice preview renders a parallel Expenses table under Services. Still deferred: receipt-document attachment UI (FK exists), markup rules, lead-level expenses (FK exists for the future conversion path).
- [~] **Notifications + bell.** v1 ✓ shipped 2026-04-25. New `Notification` model (per-user, per-event row, `readAt` for unread state, optional matter scope). Writer helpers `createNotification` / `createNotifications` (fan-out + dedup) in `src/lib/notifications.ts` mirror the `logActivity` fire-and-forget contract. Topbar `NotificationBell` self-fetches every 60s + on dropdown open, shows unread badge with the warn pip + dropdown popover (unread first, then a tail of read entries for context). Mark-one-read fires on row click; mark-all-read on header link. Per-user scoping in the action (where-clause includes userId so a guessed id can't flip another user's row). **Triggers wired today:** matter team add (notifies the new member), invoice payment recorded (fans out to the matter team minus the actor). Still deferred: deadline-approaching cron, task-assigned trigger (TaskOwner edits), settlement-step approver fan-out, email/SMS/push delivery channels, /notifications full feed page.
- [x] ~~**SOL automation.**~~ ✓ shipped 2026-04-27 in three passes. **Pass 1:** `Matter.incidentDate` + `PracticeArea.statutePeriodDays` + `statuteSourceCitation` on the schema; practice-area edit form takes years/months/days inputs (packed into total days, 365/30/d legal convention) + a citation field; matter create + update auto-populate `statuteOfLimitationsDate` from `incidentDate + area.statutePeriodDays` when both are present (explicit SOL date wins). **Pass 2:** matter create + edit forms expose the `Incident / accrual date` field with a hint that names the configured period + cite; the SOL card on the overview surfaces the cite + incident-date provenance line. **Pass 3 (already in place):** `syncMatterSolDeadline` runs on every create + update + satisfied-flip and keeps a `kind="critical"` Deadline row in sync with `Matter.statuteOfLimitationsDate` — initial set creates it; clearing SOL or switching to a non-tracking area removes it; `satisfied=true` flips it to status="completed". So a brand-new matter with an SOL date already gets the deadline auto-created.
- [x] ~~**Conflict check automation.**~~ ✓ shipped 2026-04-27. Pure matcher in `src/lib/conflict-check.ts` scans the lead's name/email/organization against existing Contacts (email match → conflict if the contact appears as opposing-side on any matter, else warn) and matter opposing-side records (legacy `Matter.opposingParty` / `.opposingFirm` text fields + structured `MatterContact` rows with `category != "client"`). Severity: clear / warn / conflict. `runLeadConflictCheck` action persists the result + timestamp; `overrideLeadConflictCheck` flips warn/conflict to "override" with a 5+ char justification (ethics-audit defensible). New permission keys: `intake.conflict_check.run` / `.override`. Both actions write `ActivityLog`. Lead detail page replaces the old static card with a live ConflictCheckCard rendering the matches table, run/re-run button, and override workflow. Bounded queries (200-row caps) so the matcher stays cheap. SQLite-friendly: app-layer `normalize()` for case-insensitive matching since Prisma's `mode: "insensitive"` isn't supported on SQLite.
- [x] ~~**Practice area stage editing.**~~ ✓ shipped. The `/settings/practice-areas/[id]` detail page has full stage CRUD: create stage, rename, mark/unmark terminal, reorder up/down, archive (refused if any active matters still sit in the stage). All actions gated on `firm.manage_practice_areas`. Each firm can shape its own pipeline.
- [ ] **Phone call / SMS / voicemail logging.** Email-only today. Real practices live on the phone. Even a simple "log a call" button (date, with-whom, duration, summary) would beat the current zero.
- [x] ~~**Settlement distribution waterfall UI.**~~ ✓ shipped 2026-04-27. Settlement card on the matter Billing tab renders the gross → firm fee → advanced costs → liens → client net waterfall. Composer captures gross / firm fee % (read layer recomputes the fee from percent at render so percentage edits propagate cleanly) / advanced costs / status (pending → approved → disbursed → closed). Lien composer + per-row negotiated/effective amount with `original` strikethrough when negotiation reduced it. **4-step approval chain** seeded on settlement create (Client release signed / Lien negotiations finalized / Partner sign-off / Trust ledger reconciliation); per-step Approve / Reject / Reset buttons gated on `matters.settlement.approve`; approver attribution + timestamp captured per step; settlement auto-promotes to `approved` when every step is approved. Permission keys: `matters.settlement.view` / `.edit` / `.manage_liens` / `.approve`. Audit-log entry on every settlement + lien + step action. Still deferred: printable / sign-off-ready distribution sheet for client signature; multi-settlement matters (today the assumption is one settlement per matter).
- [ ] **Document templates / template library.** No way to save and reuse a demand letter, discovery responses, retainer agreement.
- [ ] **Search results page + global text search.** ⌘K palette covers narrow lookups; nothing else. No results page, no save-search, no within-list keyword search beyond the matter list filters.
- [x] ~~**Multi-member matter team editor.**~~ ✓ shipped 2026-04-27. Admin-gated section on the matter edit page lets admins add/remove lead/co-counsel/paralegal/investigator/of-counsel. Promoting a new lead auto-demotes the existing one to co_counsel (humane swap). Removal is soft (`MatterTeamMember.removedAt`); former members render dimmed with "(former)" suffix on the overview roster. Audit-log entries on every add/remove. Permission key: `matters.manage_team` (admin always; other roles via the matrix).

### P2 — post-MVP but plan for it

- [x] ~~**Permission system + matrix.**~~ ✓ shipped 2026-04-27. First-class `RolePermission` join table, static permission catalog in `src/lib/permissions.ts`, runtime helpers in `src/lib/permission-check.ts` (`currentUserHasPermission` / `requirePermission` / `getCurrentUserPermissions`). Every server action and page guard funnels through a specific permission key; admin role short-circuits to all granted; user effective permissions = union across roles held. Matrix UI on `/settings/roles` lets admins (or anyone with `firm.manage_permissions`) toggle cells with optimistic UI; every non-no-op grant/revoke writes to ActivityLog. Full reference doc at `docs/PERMISSIONS.md`.
- [x] ~~**Authentication + real session**~~ ✓ shipped 2026-04-25. Auth.js v5 (next-auth) wired in `src/auth.ts` with the Credentials provider + argon2id password hashing + Prisma adapter + JWT sessions. `/login` page renders a real form; `/api/auth/[...nextauth]` handles sign-in/out. Edge proxy in `src/proxy.ts` does an optimistic cookie-presence redirect for unauthenticated requests; the authoritative check lives in `getCurrentUserId()` (server components + actions) which throws `redirect("/login")` when there's no valid session. The JWT callback re-validates the user against the DB on every request so deactivated / deleted users with stale cookies bounce automatically. Email enumeration is prevented (every failure returns null without revealing whether the email or password was wrong). Account / VerificationToken tables exist in the schema so adding Google OAuth is a config-only change.
- [x] ~~**Audit log viewer.**~~ ✓ shipped 2026-04-27. Matter-scoped Timeline tab (day-grouped journal, URL filter pills) PLUS firm-wide `/settings/activity` page (type pills + user dropdown + from/to date inputs + matter deep-links). Both gated on permissions (`firm.view_activity` for the firm-wide view). Cap at 200 rows per request — tighter filters surface older entries. Pin-to-overview, archive viewer, and PDF export are still v2.
- [ ] **Reports dashboard.** Pipeline, utilization, AR aging, realization rate — Phase 8 placeholder.
- [~] **Export / print to PDF.** Invoices ✓ shipped. Print/PDF affordance lives in two places: per-row Print icon on the matter Billing invoice table + Print button next to Close in the preview pane chrome. Both link to a chrome-free `/print/invoices/[id]?autoprint=1` route that auto-fires the browser's print dialog (where "Save as PDF" is built in). The print page reuses `InvoicePreview` with a new `printMode` flag that drops the side-panel scroll wrapper so the doc paginates naturally. Print stylesheet (US Letter, 0.5" margins, color-exact pills, no row mid-page splits) lives in `globals.css`. Demand letters + trust reports still pending.
- [ ] **Evidence viewer.** `Evidence`, `FlaggedMoment`, `EvidenceSync` schemas are designed for body-cam / dashcam timelines (§1983 use case) but no UI exists. Defer.
- [ ] **Document versioning.** No version field on Document. Will matter the second a draft pleading goes through 3+ revisions.

---

## 2. Broken / janky now

### P0 — embarrassing if anyone outside Jason sees it

- [x] ~~**Tasks have no edit / delete / status-change UI.**~~ ✓ shipped. Click the circle to toggle done; kebab menu with Edit dialog + Set status submenu + Delete on every row.
- [x] ~~**Deadlines have no edit / status-change UI.**~~ ✓ shipped. Same kebab pattern — Edit dialog + Set status (open/completed/waived) + Delete. Overdue is computed, not directly settable.
- [x] ~~**Calendar events are immutable after create.**~~ ✓ shipped. Real edit form on /calendar/events/[id]/edit replaces the old placeholder; Delete on the modal footer with confirm + redirect.
- [x] ~~**Time entries are immutable after create.**~~ ✓ shipped. Edit dialog with all billing flags + status; existing delete-blocks-billed posture extended to edits.
- [x] ~~**Disabled "Convert to matter" + "Decline" buttons on every lead.**~~ ✓ shipped — see "Lead → matter conversion" above.
- [-] ~~**Document "Add" button is a no-op.**~~ Re-classified — TabAddButton actually opens the CreateStack panel which renders an honest "form not implemented yet" placeholder with a disabled Save. Real document upload still pending P0 below.
- [x] ~~**No error boundaries anywhere.**~~ ✓ shipped. Dashboard-segment `error.tsx`, `not-found.tsx`, root `global-error.tsx`.
- [x] ~~**No loading states.**~~ ✓ shipped. `loading.tsx` per high-traffic segment, shared `<PageSkeleton>` with tiles/table/detail/grid variants.
- [-] ~~**8 settings sub-pages are stubs.**~~ Re-classified — they already render `<SettingsPlaceholder>` with expected items + blockedBy phase, which is the correct treatment.
- [x] ~~**Several matter-detail tab placeholders** — Timeline, Billing.~~ ✓ shipped — both upgraded to richer placeholders matching the SettingsPlaceholder shape (expected-items list + Phase-X dependency + pointer to FEATURES.md).

### P1 — regular workflow pain

- [ ] **No standalone Contact UI.** Contacts are only edited/created inline. Once a contact is created (e.g. opposing counsel), there's no way to update their phone number short of editing the DB. **Fix:** see P0 in §1 ("Contact directory").
- [x] ~~**Matter team is lead-only on edit.**~~ ✓ shipped 2026-04-27 — see "Multi-member matter team editor" above.
- [x] ~~**Note editor is a plain `<textarea>`.**~~ ✓ shipped. Tiptap (`@tiptap/react` + `@tiptap/starter-kit`) is wired into `NoteComposer`, `ReplyComposer`, and the `NotePanelBody` editor. HTML output sanitized server-side via DOMPurify on insert; the matter Overview's pinned-note section + the Notes tab both render the rich markup.
- [~] **Date computations use server time.** v1 ✓ shipped 2026-04-27. New `src/lib/format-date.ts` centralizes every UI-facing date format (`formatDate(d, variant, tz?)`, `formatRelative`, `formatDayBucket`, `getCurrentUserTimeZone`). `User.timeZone` field added (default `America/Denver`); profile-form picker exposes the standard US zones + UTC. Matter Timeline + `/settings/activity` page now route through the helper with the user's TZ, dashboard activity feed reads through `formatRelative`. Still pending: migrate the remaining ~35 callsites (`toLocaleDateString` / `date-fns` direct usage) — listed in MVP_TODO §2 P2 polish — and pipe TZ into `startOfToday()` / `endOfToday()` in the dashboard queries (today they still use server-local).
- [x] ~~**Trust balance is `Float`.**~~ ✓ shipped 2026-04-25. All 16 financial fields migrated to `Decimal`: `Matter.trustBalance/wipAmount`, `TimeEntry.rate/amount`, `Invoice.subtotal/taxAmount/totalAmount/paidAmount`, `TrustTransaction.amount`, `Settlement.grossAmount/firmFee/firmFeePercent/advancedCosts/clientNet`, `SettlementLien.originalAmount/negotiatedAmount`. Query layer converts Decimal → number at the API boundary. `TimeEntry.hours` stays Float (not money).
- [x] ~~**No pagination on any list query.**~~ ✓ shipped 2026-04-25 (v1 — caps not paging). 200-row cap on `listMatters` / `listLeads`, 500-row cap on `listThreads` / `listThreadsForMatter` / `listContacts`. Real "Load more" UX builds when a firm hits the cap; until then the cap prevents the unbounded-query crash.
- [ ] **Email tokens are plaintext.** `EmailAccount.accessToken` / `refreshToken` columns are plain strings. Today they're empty; the day Gmail OAuth lands they're a security incident. **Fix:** decide on encryption-at-rest (Prisma extension) or external secrets store *before* OAuth lands.
- [ ] **Hardcoded magic numbers in dashboard.** `pulse.billableGoal = 200`, `hoursGoal = 6.0` in `src/lib/queries/dashboard.ts`. Should come from firm/user settings. **Fix:** move to a `FirmSettings` or `UserSettings` model when /settings/firm is built.
- [ ] **No timezone awareness in date pickers.** When auth lands and users are in different cities, dates entered "March 15" may save as a different day depending on browser TZ. **Fix:** standardize on a `formatDateInTz` helper + ISO date inputs, not Date objects.
- [ ] **No current-user indicator in the topbar.** Today everyone is Jason; once auth lands, users won't know which account they're looking at. **Fix:** add a user avatar + menu in the topbar.
- [ ] **`ActivityLog` is written but never read.** Seed populates it; recent activity card shows the last 5; that's it. No filterable activity log per matter / per user / per type. **Fix:** add an Activity tab on matter detail (and a global firm activity page) once auth lands.
- [ ] **`/matters/[id]/intake/[id]/time` is a placeholder.** Doesn't render anything meaningful. **Fix:** either build it or remove the route.
- [x] ~~**Invalid stage transitions allowed.**~~ ✓ shipped 2026-04-27. Server returns `requiresConfirmation` for terminal → non-terminal reopens and backward jumps > 1 stage; UI surfaces the warning + retries with `force: true` on confirm. Every successful transition writes to ActivityLog with a distinctive title for reopens.

### P2 — polish and consistency

- [~] **Inconsistent date formatting.** ✓ helper landed 2026-04-27 in `src/lib/format-date.ts` (`formatDate(d, variant, tz?)`, `formatRelative`, `formatDayBucket`, `getCurrentUserTimeZone`). Three high-traffic surfaces migrated: matter Timeline tab, `/settings/activity` page, dashboard recent-activity feed. Remaining ~35 callsites on the migration list — sweep is mechanical and incremental.
- [ ] **No shared `<EmptyState>` component.** Every page invents its own — centered card, inline `text-ink-4`, etc. **Fix:** extract one with a consistent treatment + optional CTA.
- [ ] **Status / priority / role values are scattered string literals.** `"open"`, `"in_progress"`, `"urgent"`, `"lead"`, `"paralegal"`, etc. live in dozens of files. Typos would silently misclassify rows. **Fix:** centralize as TS `const` unions in `src/lib/constants/`, replace string literals.
- [ ] **Plurals are hardcoded.** "1 matters" / "1 deadlines" appear in places that don't compute the singular. **Fix:** small `plural(n, "matter")` helper.
- [ ] **PracticeArea color vs Matter color drift.** Matter snapshots area color on create; if the area color changes, matters keep the old color. May or may not be intentional — document the decision in DECISIONS.md.
- [ ] **Email labels render as raw `privileged_label` instead of "Privileged".** **Fix:** label-formatter helper.
- [ ] **Inconsistent button sizes** across cards / tables / forms. **Fix:** define a per-context size convention; sweep once.
- [ ] **No HTML sanitization on user-entered text** (matter description, note bodies). `whitespace-pre-wrap` renders raw. Stored XSS risk if multi-user / external email ever pipes content in. **Fix:** sanitize on display (DOMPurify) or store/display as Markdown.
- [ ] **`NoteRead` table will grow unbounded.** No cleanup when a note is deleted or archived. **Fix:** cascade-delete on Note delete; periodic cleanup job once row counts matter.

---

## Suggested next sprint (post 2026-04-27)

The previous "looks like a demo → pilot-ready" sprint is done. The
remaining gap to "battle-hardened production" is mostly about
governance, automation, and the workflows that surface as soon as a
second user touches the app:

1. **Stage transition guard + practice-area stage editing.** Closed → Intake should be confirmed; firms need to shape their own pipeline. (~1 day)
2. **Activity log viewer.** Matter Activity tab + global firm activity page. We already write the entries — just surface them. (~1 day)
3. **Expense tracking.** First-class `Expense` model; bills onto invoices alongside time entries; client-advanced vs firm-absorbed split for contingency. (~2 days)
4. **Notifications system.** `Notification` model, sidebar bell, deadline / task-assignment / new-email triggers, mark-read. (~3 days)
5. **Rich-text note editor.** TipTap. Bold case names, italicize statutes. (~1 day)
6. **Date format consolidation + `User.timeZone`.** Today's-agenda is server-time. Plumb a `formatDate` util through every callsite. (~1 day)
7. **Conflict check automation.** Match incoming leads against existing Contacts and opposing parties; severity + override workflow. (~2 days)
8. **SOL automation.** Auto-compute from incident date + practice-area statute table; approaching warning + auto-deadline generation. (~2 days)
9. **Settlement waterfall UI.** Schema is rich; build the gross→fees→costs→liens→client-net workflow on contingency matters. (~2 days)

After that lands, the remaining P0s (Gmail OAuth, mobile sweep) can
be tackled in order. Phone/SMS logging and document templates round
out the polish layer.
