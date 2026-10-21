# Email Record Filing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email sent from the app is filed to a matter or a lead; threads can be filed to leads; lead conversion carries threads; the lead Communication tab lists filed threads.

**Architecture:** `EmailThread` gains `leadId` beside `matterId` (at most one, app-enforced, same shape as Task/CalendarEvent) and `EmailMessage` gains `sentFromApp`. One filing action takes a `RecordScope | null`; send/reply require a scope and file before or after the Gmail call. Lead walls join matter walls in every thread query.

**Tech Stack:** Next.js (repo version, read `node_modules/next/dist/docs/` before touching routes), Prisma/Postgres, Vitest (integration tests on the Docker test DB), React client components.

**Spec:** `docs/superpowers/specs/2026-10-21-email-record-filing-design.md`

## Global Constraints

- Tests need `docker compose -f docker-compose.test.yml up -d` (Postgres :5433).
- Migration: expand-only (two nullable/default columns + index). Generate it with `prisma migrate diff` against a local Docker scratch DB, NOT `migrate dev` (`.env` DIRECT_DATABASE_URL points at remote dev). Check `printenv | grep -i database` first. Run `npm run check:migrations`.
- Commit per task with an explicit pathspec: `git add -- <paths> && git commit -m "…" -- <paths>`. Never leave files staged; other sessions share the index. Push to main after the hook passes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scope checks go through `assertScopeAccess` / `assertScopeWritable` (`src/lib/scope-access.ts`); never query a thread by `matterId`/`leadId` alone.
- Exact copy (from the spec):
  - Unfile refused: `This thread has email sent from the app, so it must stay filed. Move it to another matter or lead instead.`
  - Existing-thread notice: `Added to an existing thread filed to ${name}.`
  - Reply without file permission: `Ask someone who can file email to file this thread first.`
  - Lead tab empty state: `No emails filed to this lead yet`
  - Converted lead: reuse `assertScopeWritable`'s message.
- No new permission keys. Send = `communication.send_email`; filing (incl. file-on-reply) = `communication.file_email`.
- Activity rows: `logActivity({ matterId, leadId, … })`. Lead-scoped rows use `matterId: null, leadId`.

## Review Focus

1. **Restricted lead leaks through thread lists.** A thread filed to a restricted lead the viewer isn't on must be hidden from inbox lists, rail counts, the reader and the dashboard, exactly like a walled matter. Test in Task 3.
2. **"Unfiled" filters/counts that only test `matterId`.** A lead-filed thread must not show as unfiled in the inbox filter, rail count or dashboard triage. Test in Task 3.
3. **Lead-filed threads in the reader's matter-only affordances.** `InboxActionButtons` (`isFiled={thread.matter !== null}`) and attachment "File to matter" stay matter-only this sub-project; a lead-filed thread must render without crashing and with those buttons disabled. Test in Task 4.
4. **Stale scope posted by the composer** (record deleted, lead converted between render and send). Refused before Gmail, draft kept. Test in Task 5.
5. **Reply when the thread was filed by someone else's action between render and send** (e.g. another tab filed it). `scope` is ignored when the thread is already filed; the reply goes to the thread's record. Test in Task 6.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`model EmailThread` ~1656, `model EmailMessage` ~1696, `model Lead` relations)
- Create: `prisma/migrations/20261021180000_email_thread_lead/migration.sql`
- Modify: `docs/SCHEMA_NOTES.md`

**Interfaces:**
- Produces: `EmailThread.leadId String?` (relation `lead Lead? @relation("LeadEmailThreads", fields: [leadId], references: [id], onDelete: SetNull)`, `@@index([leadId])`), `Lead.emailThreads EmailThread[] @relation("LeadEmailThreads")`, `EmailMessage.sentFromApp Boolean @default(false)`.

- [ ] **Step 1:** Add the fields with schema comments: at most one of (`matterId`, `leadId`), neither = unfiled inbound only; lead conversion re-homes; a future lead-delete path must re-home or refuse threads with app-sent mail (`SetNull` is a fallback). On `sentFromApp`: written only by `persistSentMessage`, sync never writes it.
- [ ] **Step 2:** Generate SQL with `npx prisma migrate diff --from-url <scratch DB at previous migration> --to-schema-datamodel prisma/schema.prisma --script` into the migration file; apply to the scratch DB and the test DB.
- [ ] **Step 3:** Run `npm run check:migrations` (expect pass) and `npx prisma generate`.
- [ ] **Step 4:** Add the invariant and `sentFromApp` ownership to `docs/SCHEMA_NOTES.md` (two short bullets).
- [ ] **Step 5:** Commit `feat(email): thread lead link and sent-from-app marker`.

### Task 2: Filing action `setEmailThreadRecord`

**Files:**
- Modify: `src/app/actions/email-filing.ts` (replace `setEmailThreadMatter`)
- Create: `src/lib/email-filing.ts` (shared core used by the action and by `replyToThread` in Task 6)
- Modify: `src/app/actions/email-filing.test.ts`
- Modify: `src/components/communication/file-to-matter-picker.tsx` (call site only: pass `{kind:"matter",matterId}` / `null`; replaced in Task 4)

**Interfaces:**
- Consumes: Task 1 columns; `RecordScope`, `optionalScopeOf` (`src/lib/record-scope.ts`); `assertScopeAccess`, `assertScopeWritable`.
- Produces:
  - `fileEmailThread(userId: string, threadId: string, scope: RecordScope | null): Promise<{ ok: true } | { ok: false; error: string }>` in `src/lib/email-filing.ts` (no permission check; caller gates; does access checks, writes, logs, returns).
  - `setEmailThreadRecord(threadId: string, scope: RecordScope | null): Promise<{ ok: boolean; error?: string }>` server action: `requirePermission("communication.file_email")` then `fileEmailThread`, then revalidate `/communication`, old and new record Communication tabs.
  - `APP_SENT_UNFILE_ERROR` exported constant with the spec copy.

- [ ] **Step 1: Failing tests** in `email-filing.test.ts` (real DB; mock `next/cache`, permission-check):
  - `files an unfiled thread to a lead` → `leadId` set, `matterId` null, activity row `{ leadId, title: "Email filed to lead" }`.
  - `moves matter → lead` → clears `matterId`, logs `"Email removed from matter"` on the matter and `"Email filed to lead"` on the lead.
  - `refuses a converted lead` → error equals `assertScopeWritable` message, row unchanged.
  - `refuses unfile when a message has sentFromApp` → error `APP_SENT_UNFILE_ERROR`.
  - `allows unfile for an all-inbound thread` → both FKs null.
  - `same record is a no-op` → no activity rows.
  - `another user's thread → "Thread not found"`.
  - `restricted lead the caller isn't on → not found` (use `seedLead({ restricted: true })`; real `assertLeadAccess`).
- [ ] **Step 2:** Run `npx vitest run src/app/actions/email-filing.test.ts`; expect failures (function missing).
- [ ] **Step 3:** Implement. Target existence check by kind (matter/lead `findUnique`); write `{ matterId, leadId }` both in one `updateMany` scoped by `visibleEmailThreadWhere(userId)`; unfile check is `prisma.emailMessage.count({ where: { threadId, sentFromApp: true } }) > 0`. Titles: `Email removed from matter|lead`, `Email filed to matter|lead`; detail = subject.
- [ ] **Step 4:** Rerun; expect PASS. Update the picker call site; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(email): file threads to a matter or lead`.

### Task 3: Thread queries know about leads

**Files:**
- Modify: `src/lib/queries/communication.ts`
- Modify: `src/lib/queries/dashboard-triage.ts` (any `emailThread` `matterId` null/not-null test)
- Test: `src/lib/queries/communication.test.ts` (create if absent; else extend), `src/lib/queries/lead-wall-lists.test.ts`

**Interfaces:**
- Consumes: `leadAccessWhere(userId)` (`src/lib/lead-access.ts`).
- Produces:
  - `threadMatterAccessAnd` renamed `threadRecordAccessAnd(userId)`: matter clause AND `{ OR: [{ leadId: null }, { lead: leadAccessWhere }] }` (omitted when unrestricted). `threadMatterAccessSql` → `threadRecordAccessSql` with the lead twin (`t."leadId" IS NULL OR t."leadId" IN (…)`).
  - "Unfiled" everywhere = `matterId: null, leadId: null`; "filed" = `OR: [{ matterId: { not: null } }, { leadId: { not: null } }]` (Prisma and the raw rail SQL at ~491).
  - `ThreadDetail` gains `lead: { id: string; name: string } | null` and `hasAppSentMail: boolean`.
  - `listThreadsForLead(leadId: string, page = 1): Promise<Page<ThreadListRow>>` mirroring `listThreadsForMatter`.
  - `getFilingLeadOptions(): Promise<FilingLeadOption[]>` with `type FilingLeadOption = { id: string; name: string; stage: string }`: `leadAccessWhere`, `stage: { not: "converted" }`, `orderBy: updatedAt desc`.

- [ ] **Step 0:** Find every query to change: `grep -rn "emailThread\|t\.\"matterId\"" src/lib src/app | grep -v test`; list them in the commit body.
- [ ] **Step 1: Failing tests:**
  - `thread on a restricted lead is hidden from listThreads, rail counts and getThreadById for a non-member` and visible to a member.
  - `lead-filed thread is not counted or listed as unfiled` (filter `"unfiled"` and the rail `unfiled` count).
  - `listThreadsForLead returns only the viewer's own threads filed to the lead`.
  - `getThreadById exposes lead and hasAppSentMail`.
  - `getFilingLeadOptions omits converted and walled leads, keeps declined`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the file plus `src/lib/queries/dashboard-triage.test.ts` and `lead-wall-lists.test.ts`; expect PASS.
- [ ] **Step 5:** Commit `feat(email): lead walls and lead filing in thread queries`.

### Task 4: Record picker in the thread reader

**Files:**
- Create: `src/components/communication/record-picker.tsx` (+ `record-picker.test.tsx`)
- Create: `src/components/communication/file-thread-picker.tsx` (+ test), replacing `file-to-matter-picker.tsx` (delete it and its test)
- Modify: `src/components/communication/thread-reader.tsx`, and every page passing `filingOptions` (grep `getFilingMatterOptions`) to also pass lead options

**Interfaces:**
- Consumes: `FilingMatterOption`, `FilingLeadOption`, `setEmailThreadRecord`, `ThreadDetail.lead` / `.hasAppSentMail`.
- Produces:
  - `RecordPicker({ matters, leads, value, onChange, disabled?, placeholder? })` where `value: RecordScope | null`, `onChange(scope: RecordScope | null)`. Searchable, grouped "Matters" / "Leads"; pure selection, no server calls. Reused by Tasks 7 and 8.
  - `FileThreadPicker({ threadId, current: RecordScope | null, currentLabel: string | null, matters, leads, canFile, canUnfile })`: wraps `RecordPicker`, calls `setEmailThreadRecord`, shows the error inline. "Unfile" item rendered only when `canUnfile` (reader passes `!thread.hasAppSentMail`).

- [ ] **Step 1: Failing tests:** picker groups matters and leads and filters by search text; `FileThreadPicker` hides Unfile when `canUnfile` false; selecting a lead calls `setEmailThreadRecord(threadId, { kind: "lead", leadId })`; a lead-filed thread renders the reader with `InboxActionButtons` disabled (Review Focus 3, pass `isFiled={thread.matter !== null}` unchanged).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement, matching the existing picker's styling and client-side filter idiom.
- [ ] **Step 4:** Run component tests; `npm run typecheck && npm run lint`.
- [ ] **Step 5:** Commit `feat(email): file threads to leads from the reader`.

### Task 5: `sendEmail` requires a record

**Files:**
- Modify: `src/app/actions/email-send.ts` (`SendEmailInput`, `SendEmailResult`, `sendEmail`, `persistSentMessage`, `revalidateSendSurfaces`)
- Modify: `src/app/actions/email-send.test.ts`

**Interfaces:**
- Consumes: Task 1 columns; `assertScopeAccess`, `assertScopeWritable`.
- Produces:
  - `SendEmailInput.scope: RecordScope` (required).
  - Success result gains `notice?: string`.
  - `persistSentMessage` options gain `scope: RecordScope | null` (null for replies, Task 6) and return `{ threadId, matterId, leadId, notice? }`; it sets `sentFromApp: true` on create AND update of our message row (update `{ sentFromApp: true }` only).
  - `revalidateSendSurfaces(scope: RecordScope | null)`.

- [ ] **Step 1: Failing tests** (Gmail mocked):
  - `refuses without scope / with a converted lead / with a missing matter before calling Gmail` → `gmailFetch` not called, `{ ok: false }` (Review Focus 4).
  - `files the new thread to the lead and marks sentFromApp`.
  - `logs "Email sent" on the lead` (`leadId` on the activity row).
  - `Gmail returns a thread already filed elsewhere` → filing unchanged, `notice === "Added to an existing thread filed to Other Matter."`.
  - `Gmail returns an existing unfiled thread` → filed to the scope.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Validation order: permission → account → scope (`assertScopeAccess`, then `assertScopeWritable`, then existence) → recipients → Gmail. On a newly created thread write the scope in the `create`; on an existing thread with no filing, update it; filed elsewhere → notice with that record's name. Activity on the final thread's record.
- [ ] **Step 4:** Run; expect PASS (existing tests updated to pass a scope).
- [ ] **Step 5:** Commit `feat(email): every sent email is filed to a matter or lead`.

### Task 6: `replyToThread` files unfiled threads first

**Files:**
- Modify: `src/app/actions/email-send.ts`, `src/app/actions/email-send.test.ts`

**Interfaces:**
- Consumes: `fileEmailThread` (Task 2), `currentUserHasPermission`.
- Produces: `ReplyToThreadInput.scope?: RecordScope`; `REPLY_NEEDS_FILER_ERROR` constant with the spec copy.

- [ ] **Step 1: Failing tests:**
  - `unfiled thread + scope files then sends` → thread `leadId` set, Gmail called, message `sentFromApp`.
  - `unfiled thread without scope` → `{ ok: false }`, Gmail not called.
  - `unfiled thread without communication.file_email` → error `REPLY_NEEDS_FILER_ERROR`, Gmail not called.
  - `filing succeeds, Gmail fails` → thread stays filed, `{ ok: false }`.
  - `filed thread ignores a posted scope` → stays on its record (Review Focus 5).
  - `activity "Email reply sent" logs on a lead-filed thread's lead`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Replace `assertOptionalMatterAccess(thread.matterId)` with `assertScopeAccess` on `optionalScopeOf(thread)` when filed. If unfiled: require scope, check `file_email`, call `fileEmailThread(userId, threadId, scope)` and return its error if not ok; then continue the existing send path. Re-read the thread's record after filing for activity/revalidation.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(email): replying to an unfiled thread files it first`.

### Task 7: Compose takes a record; compose on matter and lead tabs

**Files:**
- Modify: `src/components/communication/compose-email.tsx` (+ test), `compose-email-launcher.tsx`
- Modify: `src/app/(dashboard)/matters/[id]/communication/page.tsx`, `src/app/(dashboard)/intake/[id]/communication/page.tsx` (mount launcher)

**Interfaces:**
- Consumes: `RecordPicker`, `getFilingMatterOptions`, `getFilingLeadOptions`, `sendEmail` with `scope`.
- Produces: `ComposeEmailLauncher({ initialScope?: RecordScope })`; `ComposeEmailButton({ accounts, matters, leads, initialScope? })`.

- [ ] **Step 1: Failing tests** in `compose-email.test.tsx`: Send disabled until a record is chosen; `initialScope` prefills and is editable; `sendEmail` receives `scope`; a success `notice` is shown after the draft clears; the record resets to `initialScope` on reset.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. The launcher loads options only when the user can send. The matter tab mounts it in the email channel header with `{ kind: "matter", matterId }`; the lead tab with `{ kind: "lead", leadId }`, hidden for converted leads.
- [ ] **Step 4:** Run tests; typecheck; lint.
- [ ] **Step 5:** Commit `feat(email): compose requires a matter or lead`.

### Task 8: Reply composer picker on unfiled threads

**Files:**
- Modify: `src/components/communication/reply-composer.tsx`, `reply-section.tsx` (+ tests)
- Modify: `thread-reader.tsx` and embedded readers that mount `ReplySection` (pass options, `isFiled`, `canFileEmail`)

**Interfaces:**
- Consumes: `RecordPicker`, `replyToThread` with `scope`, `REPLY_NEEDS_FILER_ERROR` copy.
- Produces: `ReplyComposer` props gain `needsRecord: boolean`, `canFile: boolean`, `matters`, `leads`.

- [ ] **Step 1: Failing tests:** filed thread → no picker; unfiled + `canFile` → picker shown, Send disabled until chosen, `replyToThread` gets `scope`; unfiled + `!canFile` → message `Ask someone who can file email to file this thread first.` and no Send.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; after a successful send `router.refresh()` (already present) shows the new filing.
- [ ] **Step 4:** Run; typecheck; lint.
- [ ] **Step 5:** Commit `feat(email): pick a record when replying to an unfiled thread`.

### Task 9: Lead conversion carries email threads

**Files:**
- Modify: `src/app/actions/leads.ts` (`convertLeadToMatter`, the re-home block ~620–640 and the timeline log ~769)
- Modify: `src/app/actions/leads.test.ts`

**Interfaces:**
- Produces: `carriedEmailThreadCount` in the transaction result.

- [ ] **Step 1: Failing tests:** `conversion moves every user's lead threads to the matter` (two users' threads; both end `matterId = matter.id, leadId = null`); `timeline entry mentions "2 email threads carried over"`; zero threads → no such line.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the `updateMany` beside the task/event re-homes; append the line to the existing "Converted from lead" entry's `detail` (join with the source line), using `plural()`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(intake): lead conversion carries email threads`.

### Task 10: Lead Communication tab lists filed threads

**Files:**
- Modify: `src/app/(dashboard)/intake/[id]/communication/page.tsx` (+ page header comment)
- Modify: `src/lib/queries/communication.ts` (delete `listThreadsForEmail` and its cap constant if unused), `src/lib/email-visibility.ts` comment
- Test: extend the query test from Task 3 or the page's existing test

- [ ] **Step 1: Failing test:** the lead tab's email list shows a thread filed to the lead and not one that only matches the contact's address; `?thread=` for a thread filed elsewhere renders no reader.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Switch to `listThreadsForLead` with `parsePageParam`; empty state `No emails filed to this lead yet` with the compose launcher; email list renders regardless of contact email. SMS/calls untouched. Delete `listThreadsForEmail` if `grep` shows no users.
- [ ] **Step 4:** Run; `npm run typecheck && npm run lint`.
- [ ] **Step 5:** Commit `feat(intake): lead communication shows filed email`.

### Task 11: Docs and cleanup

**Files:**
- Create: `docs/decisions/0NN-every-app-sent-email-is-filed.md` (next number) + row in `docs/decisions/README.md`
- Modify: `docs/features/communication-email.md`, `docs/features/intake.md`, `docs/ROADMAP.md` (email line)
- Delete: this plan and the spec

- [ ] **Step 1:** ADR: context (not a free-form client; replies categorize threads), decision (send requires a record; unfile refused with app-sent mail; contact matching deferred to a categorizer), trade-offs.
- [ ] **Step 2:** Feature files: end-state description of filing to leads, the sent-mail rule, conversion carry, lead tab; note sub-project 2 (attachments) as next.
- [ ] **Step 3:** Run full `npm test`; expect PASS.
- [ ] **Step 4:** Commit `docs(email): record filing shipped` including the deletions; push.
