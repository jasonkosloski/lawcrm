# MVP To-Do

A brutally honest punch-list to get this CRM from "looks-like-an-app" to "a
solo lawyer can run their practice on it." Two sections:

1. **Missing features** — capabilities that don't exist yet
2. **Broken / janky** — capabilities that exist but don't work right

Each item has a priority (P0 = blocks MVP, P1 = MVP usability, P2 = polish)
and, where applicable, file paths so you can dive straight in.

Last full audit: 2026-04-24

> **Update — 2026-04-25:** Big sprint landed against this list. Items
> below struck through and tagged ✓ shipped. The remaining P0 work is
> all the stuff that needs your input on infra (Gmail OAuth creds,
> document-storage choice, invoice/trust scoping, mobile sweep).

---

## 1. Missing features for MVP

### P0 — cannot ship without these

- [ ] **Email send / reply / file-to-matter + Gmail OAuth.** Communication tab is read-only (`src/app/(dashboard)/communication/page.tsx`). The single biggest broken promise of this app — a "unified inbox" you can't send from. Needs OAuth flow, two-way sync, compose window, reply, and a "file thread to matter" action.
- [x] ~~**Contact directory.**~~ ✓ shipped. `/contacts` with search + per-type filter pills, detail page (profile + linked matters as client and as party), full create + edit + soft-delete. Wired into sidebar + command palette. Conflict-flag UI + merge are tracked as v2 in FEATURES.md.
- [ ] **Document upload & storage.** `/matters/[id]/documents` lists documents, but `TabAddButton` href is `null` and there's no upload UI. No S3 / Vercel Blob integration. No file viewer, no download. Lawyers can't actually keep their case files here.
- [x] ~~**Lead → matter conversion.**~~ ✓ shipped. Both buttons are real now: Decline opens a reason-capture dialog and flips the lead, Convert opens a practice-area + stage + matter-name + fee picker and creates Matter + Contact + team assignment + sidebar pin in one transaction. Lead summary/incident date/injuries flow into Matter.description. Practice-area-specific automations on convert (CGIA / HUD / EEOC) tracked as v2 in FEATURES.md.
- [ ] **Invoice generation + trust ledger.** All of Phase 6 is empty. `Invoice`, `Settlement`, `TrustTransaction`, `SettlementApproval`, `SettlementLien` models exist with rich fields, but zero UI. `/matters/[id]/billing` is a stub. No way to bill a client, log a trust deposit, or distribute a settlement. A solo lawyer will not adopt a CRM that can't bill.
- [ ] **Mobile / responsive layout.** Sidebar doesn't collapse, calendar + matters table assume desktop width, no breakpoints anywhere. Field work — depositions, court appearances, client meetings — is impossible on iPad/iPhone.

### P1 — MVP usability

- [ ] **Calendar event create/edit form.** `EventComposer` exists for matter-detail event creation, but there's no full-featured event-editor (start/end + all-day, type, attendees, location/Zoom, recurrence). Currently events are immutable after creation.
- [ ] **Expense tracking.** No `Expense` model. No way to log filing fees, expert witness costs, deposition transcripts, travel. Invoices will be incomplete.
- [ ] **Notifications + bell.** No `Notification` model. No alerts for approaching deadlines, new email, task assignments. The sidebar bell was deliberately removed pending this work — restore as part of it.
- [ ] **SOL automation.** SOL fields on Matter are 100% manual. No auto-compute from incident date + practice-area statute table, no "approaching" warning, no auto-deadline generation.
- [ ] **Conflict check automation.** `Contact.conflictStatus` and `Lead.conflictCheck` exist but are never written to by any code path. No matching engine against existing matters/parties when a lead arrives, no "block save" guardrail, no override workflow.
- [ ] **Practice area stage editing.** You can create a practice area, but stages are seeded once and can't be renamed, reordered, or archived. Each firm has its own pipeline — this blocks adoption beyond default workflows.
- [ ] **Phone call / SMS / voicemail logging.** Email-only today. Real practices live on the phone. Even a simple "log a call" button (date, with-whom, duration, summary) would beat the current zero.
- [ ] **Settlement distribution waterfall UI.** Schema is rich (gross → fees → costs → liens → client net) but there is no UI. Personal injury / civil rights firms need this on every case.
- [ ] **Document templates / template library.** No way to save and reuse a demand letter, discovery responses, retainer agreement.
- [ ] **Search results page + global text search.** ⌘K palette covers narrow lookups; nothing else. No results page, no save-search, no within-list keyword search beyond the matter list filters.
- [ ] **Multi-member matter team editor.** Matter edit form lets you change the lead attorney; you can't add/remove paralegal, investigator, of-counsel, or co-counsel. Team roster on Overview is read-only.

### P2 — post-MVP but plan for it

- [ ] **Authentication + real session** (Phase 9). Solo Jason can run today on the hardcoded user. Multi-user features are blocked until auth lands. See "Time bombs" in §2.
- [ ] **Audit log viewer.** `ActivityLog` is populated by seed and a few writes but never displayed anywhere. Compliance + dispute resolution use case.
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
- [ ] **Matter team is lead-only on edit.** Edit form changes lead attorney, but the rest of the team (paralegal, investigator, of-counsel) is read-only on Overview and uneditable. **Fix:** team-member editor as part of the matter edit page.
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
- [ ] **Invalid stage transitions allowed.** Matter can be moved from "Closed" back to "Intake" with no warning. **Fix:** add a `canTransitionTo(currentStageId, newStageId)` guard on the stage action.

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

## Suggested next sprint (1–2 weeks)

If I had to pick the smallest set of work that would make the app feel "done" to a solo user who already lives in it:

1. **Task / deadline / event / time-entry edit + delete + status toggle.** Five copies of the same problem. Once one is solved the pattern repeats. (~3 days)
2. **Hide or explain every dead-end button** (Decline, Convert to matter, Document Add, settings stubs, matter-detail stubs). (~½ day)
3. **`error.tsx` + `loading.tsx` per route segment.** (~1 day)
4. **Contact directory** at `/contacts` with list + detail + edit + create. (~2 days)
5. **Calendar event editor** (full form). (~1 day)
6. **Trust balance: Decimal migration + invoice list page (read-only first cut).** (~2 days)
7. **Mobile breakpoints on the most-used routes** (dashboard, matter detail, calendar week view). (~2 days)

That's a believable two-week slice that takes the app from "demo" to "I could pilot this with one paralegal." Everything else can land iteratively.
