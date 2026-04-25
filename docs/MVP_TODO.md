# MVP To-Do

A brutally honest punch-list to get this CRM from "looks-like-an-app" to "a
solo lawyer can run their practice on it." Two sections:

1. **Missing features** — capabilities that don't exist yet
2. **Broken / janky** — capabilities that exist but don't work right

Each item has a priority (P0 = blocks MVP, P1 = MVP usability, P2 = polish)
and, where applicable, file paths so you can dive straight in.

Last full audit: 2026-04-24

---

## 1. Missing features for MVP

### P0 — cannot ship without these

- [ ] **Email send / reply / file-to-matter + Gmail OAuth.** Communication tab is read-only (`src/app/(dashboard)/communication/page.tsx`). The single biggest broken promise of this app — a "unified inbox" you can't send from. Needs OAuth flow, two-way sync, compose window, reply, and a "file thread to matter" action.
- [ ] **Contact directory.** `Contact` model exists but has no top-level route. Contacts are only created/found inline as matter parties or via the new-matter form. No standalone `/contacts` list, no contact detail page, no way to manage opposing counsel / experts / medical providers as a master list, no merge, no edit. Without this, conflict checking is impossible.
- [ ] **Document upload & storage.** `/matters/[id]/documents` lists documents, but `TabAddButton` href is `null` and there's no upload UI. No S3 / Vercel Blob integration. No file viewer, no download. Lawyers can't actually keep their case files here.
- [ ] **Lead → matter conversion.** "Convert to matter" and "Decline" buttons on `src/app/(dashboard)/intake/[id]/layout.tsx:67,71` are hardcoded `disabled`. Lead intake is the front door of the practice — and once you have a lead, you can't do anything with it.
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

- [ ] **Tasks have no edit / delete / status-change UI.** `src/app/(dashboard)/matters/[id]/tasks/page.tsx:109-160` — task rows display a circle that *looks* like a checkbox but has no `onClick`. Can't mark done, can't reassign, can't change priority, can't delete. Same problem on the new dashboard "Your tasks" card. **Fix:** make the circle a real toggle with an `updateTaskStatus` server action; add a row menu with edit/reassign/delete.
- [ ] **Deadlines have no edit / status-change UI.** `/matters/[id]/deadlines` lists them, can't toggle open → completed/waived, can't edit date, can't delete. **Fix:** add inline status menu + edit modal + delete confirmation.
- [ ] **Calendar events are immutable after create.** Click an event → modal opens → can read but not edit or delete. Creating a single typo means living with it. **Fix:** add edit/delete actions to `EventDetailModal`, hook to `updateCalendarEvent` / `deleteCalendarEvent` server actions.
- [ ] **Time entries are immutable after create.** Same pattern — `/matters/[id]/time` lists them, no edit/delete. Status (`draft`/`billed`) can't be changed from the UI. **Fix:** edit modal + delete + a "mark billed" bulk action.
- [ ] **Disabled "Convert to matter" + "Decline" buttons on every lead.** `src/app/(dashboard)/intake/[id]/layout.tsx:67,71` — `disabled` with `title="Coming soon"`. Looks finished, does nothing. **Fix:** either remove from the UI until Phase 3 work lands, or replace with a modal explaining what's coming.
- [ ] **Document "Add" button is a no-op.** `TabAddButton` on documents page has `href={null}`. **Fix:** either hide the button or wire a placeholder upload modal.
- [ ] **No error boundaries anywhere.** No `error.tsx`, no `not-found.tsx`. If any Prisma query throws, the whole route 500s with a stack trace. **Fix:** add `error.tsx` per route segment with a retry button + a global `not-found.tsx`.
- [ ] **No loading states.** No `loading.tsx`, no Suspense, no skeletons. Every route blocks on the slowest query. On a slow connection the app feels frozen. **Fix:** add `loading.tsx` skeletons for at least the dashboard, matter detail tabs, calendar, and intake list.
- [ ] **8 settings sub-pages are stubs.** `/settings/security`, `/team`, `/firm`, `/integrations`, `/billing`, `/notifications` all live in nav but render placeholder. **Fix:** either hide nav entries until ready, or render an explicit "Phase X — not yet implemented" card with a link to FEATURES.md.
- [ ] **Several matter-detail tab placeholders** — Timeline, Billing. Same problem: tab in nav, dead end on click. **Fix:** same as above.

### P1 — regular workflow pain

- [ ] **No standalone Contact UI.** Contacts are only edited/created inline. Once a contact is created (e.g. opposing counsel), there's no way to update their phone number short of editing the DB. **Fix:** see P0 in §1 ("Contact directory").
- [ ] **Matter team is lead-only on edit.** Edit form changes lead attorney, but the rest of the team (paralegal, investigator, of-counsel) is read-only on Overview and uneditable. **Fix:** team-member editor as part of the matter edit page.
- [ ] **Note editor is a plain `<textarea>`.** No formatting, no markdown, no rich text. Lawyers expect to bold case names and italicize statutes. **Fix:** swap in TipTap or switch to Markdown rendering.
- [ ] **Date computations use server time.** `src/lib/queries/dashboard.ts:14-32` — `new Date()` everywhere. "Today's agenda" and "this week's deadlines" will be wrong for any user not in server time zone. **Fix:** add `User.timeZone`, plumb through to `startOfToday()` / `endOfToday()` / etc.
- [ ] **Trust balance is `Float`.** `Matter.trustBalance` and aggregates on `prisma/schema.prisma`. Float math will produce rounding errors on real money. Bar regulators do not love rounding errors in IOLTA accounting. **Fix:** migrate to `Decimal` before any real money is tracked.
- [ ] **No pagination on any list query.** `listMatters()`, `listLeads()`, `listEmailThreads()`, etc. all `findMany()` without `take`. Fine at 50 matters; will crash at 5,000. **Fix:** add `take`/`skip` + cursor pagination on top-level lists now, before bad habits set in everywhere.
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
