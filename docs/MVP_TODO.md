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
- [~] **Invoice generation + trust ledger** (v1 shipped 2026-04-25, refactored 2026-04-27). `/matters/[id]/billing` carries the full client invoice state machine (draft → approved → sent → partial → paid; void only with no payments; drafts deletable). Send dialog with optional trust application; Apply trust shortcut; Record payment with multi-channel support (check / ACH / cash / card / other / trust). Notify-client checkbox on every payment surface. Matter-level Received payments ledger. Decimal math throughout. **Still deferred:** invoice line-item editing, expense tracking model + UI, real PDF export, real email/mail delivery (Gmail integration blocks), settlement distribution waterfall, tax calculation, AR firm-wide page, recurring invoices, payment-gateway integration. Settlement / SettlementApproval / SettlementLien models still empty UI.
- [ ] **Mobile / responsive layout.** Sidebar doesn't collapse, calendar + matters table assume desktop width, no breakpoints anywhere. Field work — depositions, court appearances, client meetings — is impossible on iPad/iPhone.

### P1 — MVP usability

- [ ] **Calendar event create/edit form.** `EventComposer` exists for matter-detail event creation, but there's no full-featured event-editor (start/end + all-day, type, attendees, location/Zoom, recurrence). Currently events are immutable after creation.
- [~] **Expense tracking.** v1 ✓ shipped 2026-04-27 — first-class `Expense` model, composer + table on the matter Time & Expenses tab, granular `matters.expense.{view,create,edit,delete}` permissions in the matrix, soft refusal of edit/delete once an expense has been billed onto an invoice, audit-log on every action. Still deferred: rolling expenses into invoice generation alongside time entries (today they're tracked but the WIP-bundling action only pulls TimeEntry rows), receipt-document attachment UI (FK exists), markup rules, lead-level expenses (FK exists for the future conversion path).
- [ ] **Notifications + bell.** No `Notification` model. No alerts for approaching deadlines, new email, task assignments. The sidebar bell was deliberately removed pending this work — restore as part of it.
- [~] **SOL automation.** v1 ✓ shipped 2026-04-27. `Matter.incidentDate` + `PracticeArea.statutePeriodDays` + `statuteSourceCitation` on the schema. Practice-area edit form exposes years/months/days inputs (packed into total days at write time using the legal 365/30/d convention) + a citation field. Matter create + update auto-populate `statuteOfLimitationsDate` from `incidentDate + area.statutePeriodDays` when both are present; explicit SOL date entered on the form wins so the user can always override. Existing SOL card already has tier-based warnings (60d / 30d / past-due). Still pending: surface the citation on the SOL card, expose `incidentDate` on the matter create / edit forms, auto-create a `Deadline` row when SOL is set (existing SOL ↔ Deadline mirror handles this on satisfied flips, not on initial set).
- [ ] **Conflict check automation.** `Contact.conflictStatus` and `Lead.conflictCheck` exist but are never written to by any code path. No matching engine against existing matters/parties when a lead arrives, no "block save" guardrail, no override workflow.
- [x] ~~**Practice area stage editing.**~~ ✓ shipped. The `/settings/practice-areas/[id]` detail page has full stage CRUD: create stage, rename, mark/unmark terminal, reorder up/down, archive (refused if any active matters still sit in the stage). All actions gated on `firm.manage_practice_areas`. Each firm can shape its own pipeline.
- [ ] **Phone call / SMS / voicemail logging.** Email-only today. Real practices live on the phone. Even a simple "log a call" button (date, with-whom, duration, summary) would beat the current zero.
- [ ] **Settlement distribution waterfall UI.** Schema is rich (gross → fees → costs → liens → client net) but there is no UI. Personal injury / civil rights firms need this on every case.
- [ ] **Document templates / template library.** No way to save and reuse a demand letter, discovery responses, retainer agreement.
- [ ] **Search results page + global text search.** ⌘K palette covers narrow lookups; nothing else. No results page, no save-search, no within-list keyword search beyond the matter list filters.
- [x] ~~**Multi-member matter team editor.**~~ ✓ shipped 2026-04-27. Admin-gated section on the matter edit page lets admins add/remove lead/co-counsel/paralegal/investigator/of-counsel. Promoting a new lead auto-demotes the existing one to co_counsel (humane swap). Removal is soft (`MatterTeamMember.removedAt`); former members render dimmed with "(former)" suffix on the overview roster. Audit-log entries on every add/remove. Permission key: `matters.manage_team` (admin always; other roles via the matrix).

### P2 — post-MVP but plan for it

- [x] ~~**Permission system + matrix.**~~ ✓ shipped 2026-04-27. First-class `RolePermission` join table, static permission catalog in `src/lib/permissions.ts`, runtime helpers in `src/lib/permission-check.ts` (`currentUserHasPermission` / `requirePermission` / `getCurrentUserPermissions`). Every server action and page guard funnels through a specific permission key; admin role short-circuits to all granted; user effective permissions = union across roles held. Matrix UI on `/settings/roles` lets admins (or anyone with `firm.manage_permissions`) toggle cells with optimistic UI; every non-no-op grant/revoke writes to ActivityLog. Full reference doc at `docs/PERMISSIONS.md`.
- [ ] **Authentication + real session** (Phase 9). Solo Jason can run today on the hardcoded user. Multi-user features are blocked until auth lands. See "Time bombs" in §2.
- [x] ~~**Audit log viewer.**~~ ✓ shipped 2026-04-27. Matter-scoped Timeline tab (day-grouped journal, URL filter pills) PLUS firm-wide `/settings/activity` page (type pills + user dropdown + from/to date inputs + matter deep-links). Both gated on permissions (`firm.view_activity` for the firm-wide view). Cap at 200 rows per request — tighter filters surface older entries. Pin-to-overview, archive viewer, and PDF export are still v2.
- [ ] **Reports dashboard.** Pipeline, utilization, AR aging, realization rate — Phase 8 placeholder.
- [ ] **Export / print to PDF.** Demand letters, invoices, trust reports — none of it can be exported.
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
- [ ] **Note editor is a plain `<textarea>`.** No formatting, no markdown, no rich text. Lawyers expect to bold case names and italicize statutes. **Fix:** swap in TipTap or switch to Markdown rendering.
- [ ] **Date computations use server time.** `src/lib/queries/dashboard.ts:14-32` — `new Date()` everywhere. "Today's agenda" and "this week's deadlines" will be wrong for any user not in server time zone. **Fix:** add `User.timeZone`, plumb through to `startOfToday()` / `endOfToday()` / etc.
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

- [ ] **Inconsistent date formatting.** Some pages use `toLocaleDateString`, some use ad-hoc string slicing, some use date-fns. **Fix:** one `formatDate(d, "short" | "long" | "relative")` util in `src/lib/format.ts`, replace all callers.
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
