# Records Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track records requests (medical, CORA/CGIA, police…) on matters and intake leads. Each request has:

- firm-defined types with statutory response periods
- a rolling auto-created follow-up task
- a request letter generated from a template
- received records uploaded or linked
- a fee that becomes an Expense

Everything carries to the matter on conversion.

**Architecture:**

- **Models:** a dedicated `RecordsRequest` model (exactly-one `matterId`/`leadId` scope, reusing `src/lib/record-scope.ts`) and a firm-configured `RecordsRequestType`.
- **Pure rules** (due dates, status transitions, overdue, folder naming) live in `src/lib/records-requests/`.
- **Writes** are server actions in `src/app/actions/records-requests.ts` and `records-request-types.ts`.
- **Links out to existing systems:** `Document.recordsRequestId`, `Task.recordsRequestId`, and `RecordsRequest.expenseId`.
- **UI:** a shared `RecordsTab` server component renders on both the matter and intake routes.

**Tech Stack:** Next.js (this repo's version; read `node_modules/next/dist/docs/` before adding routes), Prisma 7 / Postgres, Vitest (integration tests on the Docker test DB), React 19 server components + server actions.

**Spec:** `docs/superpowers/specs/2026-10-18-records-requests-design.md`

## Global Constraints

- Statuses (exact strings, this order): `draft`, `sent`, `acknowledged`, `partial`, `complete`. Terminal side-exits: `denied`, `withdrawn`. Terminal set = `complete`, `denied`, `withdrawn`.
- Transitions:
  - A non-terminal status may move to any **later** non-terminal status, or to any terminal one.
  - A terminal status may reopen to any non-terminal one (logged as "Records request reopened").
  - Nothing moves backwards between non-terminal statuses.
- `RecordsPeriodUnit` enum: `CALENDAR_DAYS | BUSINESS_DAYS`.
- Calendar days: due = sentAt + N.
- Business days: day 1 = first weekday after sentAt, and Sat/Sun are skipped. There is no holiday calendar.
- `followUpDays` defaults to 7 (range 1–90). Ad hoc requests use 7.
- First follow-up date = sentAt + followUpDays. Every later one = today + followUpDays.
- Follow-up task: title `Follow up: {custodian name} — {type name}`, due `nextFollowUpDate`, owner = request owner, same scope as the request.
- At most one open follow-up task per request (open = status `open` or `in_progress`).
- Request folder: `Records` (root) / `{custodian} — {type}`, created on first use, with names cleaned and collision-suffixed.
- Document roles (exact strings): `request_letter`, `received_records`.
- Fee → Expense on a matter: category `records`, `billable: true`, `date` = feePaidAt, description `Records — {custodian} ({type})`, `loggedBy` = actor. An invoiced Expense (`invoiceId` set) locks the fee fields.
- Seeded types (inserted by the migration so production gets them):
  - Medical (HIPAA): 30 calendar days
  - CORA: 3 business days
  - Police report: 3 business days
  - Employment: 30 calendar days
  - All with followUpDays 7.
- Permission keys (new "Records requests" group, id `records`): `records.view`, `records.create`, `records.edit`, `records.delete`, `records.types.manage`.
  - Existing keys still apply on top: `documents.upload` (letter, upload), `matters.expense.create` / `matters.expense.edit` (fee → Expense).
  - Follow-up tasks need no `tasks.create`.
- Scope access goes through `assertScopeAccess(scope)` from `src/lib/scope-access.ts`.
  - Lead-scope writes on a converted lead are refused via `assertScopeWritable(scope)`: "This lead is already converted — add this on the matter instead."
  - Lead-scoped activity rows use `matterId: null`.
- Dates are date-only (ADR-012): parse with `parseDateOnly`, display with `formatDateOnly`, compare via `todayKey(tz)` / `dateOnlyKey`. Money is `Decimal(14,2)` (ADR-036).
- Migration directory: `prisma/migrations/20261018190000_records_requests/`, generated with `prisma migrate diff --from-schema <old copy> --to-schema prisma/schema.prisma --script`, then append the seed `INSERT`s.
- Tests run with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, proceed"` exported in the same shell (local Docker test DB only).
- No prisma command against any other database.
- Commit on `main`; never push.

## Review Focus

1. **A follow-up task completed twice, or after the request is closed.** Completing a follow-up task when the request is already complete/denied/withdrawn, or completing the same task again (done → reopen → done), must never create an extra task. At most one task stays open. Test: Task 4.
2. **Reassigning the request owner.** The open follow-up task's owner changes with it; the old owner isn't left chasing. Test: Task 3.
3. **Changing the type after the request is sent.** This doesn't silently recompute `responseDueDate` (the date stays as set, and stays editable). Test: Task 3.
4. **Deleting a request that has an open follow-up task.** The task is cancelled, not left dangling. Linked documents and the Expense survive. Test: Task 3.
5. **Uploading or generating against the wrong scope.** If the `recordsRequestId` doesn't belong to the upload/generate scope (e.g. a stale intake tab after conversion), the server rejects it with 400 / `{ok:false}` before storing anything. Test: Task 6.

---

### Task 1: Schema, migration with seeded types, permissions

**Files:**

- Modify: `prisma/schema.prisma` (new `RecordsRequestType`, `RecordsRequest`, `RecordsRequestFollowUp`, enum `RecordsPeriodUnit`; new nullable FKs `Document.recordsRequestId` + `Document.recordsRequestRole String?`, `Task.recordsRequestId`; inverse relations on Matter, Lead, Contact, User, Expense, DocumentTemplate)
- Create: `prisma/migrations/20261018190000_records_requests/migration.sql`
- Modify: `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `docs/SCHEMA_NOTES.md`, `docs/PERMISSIONS.md`

**Interfaces:**

- Produces:
  - **Prisma models** with the spec's field table verbatim.
  - **FKs:**
    - `custodianContactId` → Contact `onDelete: Restrict`
    - `typeId` → SetNull
    - `ownerId` → User SetNull
    - `expenseId String? @unique` → Expense SetNull
    - `matterId` → Matter Cascade
    - `leadId` → Lead Cascade
    - `RecordsRequestFollowUp.requestId` → Cascade
    - `Document.recordsRequestId` → SetNull
    - `Task.recordsRequestId` → SetNull
  - **Indexes:** matterId, leadId, status, ownerId, (status, nextFollowUpDate), (status, responseDueDate) on requests; `Document.recordsRequestId`; `Task.recordsRequestId`.
  - **Permissions:** the `records` group with the five keys. Each key gets a label and description matching the spec bullets.

- [ ] **Step 1:** Add the five keys to `permissions.test.ts`'s expected list. Run `npx vitest run src/lib/permissions.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Add the permission group. Re-run. Expected: PASS.
- [ ] **Step 3:** Make the schema changes. Generate the migration SQL, then append `INSERT INTO "records_request_types" (...)` for the four seeded types (cuid-like ids via `'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)`, sortOrder 0–3, `isActive` true). Run `npx prisma generate`.
- [ ] **Step 4:** Run `npm run typecheck && npm run check:migrations`. Expected: 0 errors, "migrations match schema.prisma".
- [ ] **Step 5:** SCHEMA_NOTES: rows for the three new models + a changelog line naming the migration and the seeded types. PERMISSIONS.md: point at the new group in `permissions.ts`, without duplicating the key list.
- [ ] **Step 6: Commit** `feat(records): schema, seeded request types, permissions`.

### Task 2: Pure rules (due date, status, overdue, folder name)

**Files:**

- Create: `src/lib/records-requests/due-date.ts`, `status.ts`, `folder-name.ts`, and a `*.test.ts` beside each

**Interfaces:**

- Produces:
  - `computeResponseDue(sentAt: Date, amount: number, unit: "CALENDAR_DAYS" | "BUSINESS_DAYS"): Date`. Input and output are UTC-midnight date-only.
  - `addCalendarDays(date: Date, days: number): Date`, date-only.
  - `RECORDS_REQUEST_STATUSES` (ordered tuple), `type RecordsRequestStatus`, `RECORDS_TERMINAL_STATUSES`, `RECORDS_STATUS_LABEL: Record<RecordsRequestStatus, string>` ("Draft", "Sent", "Acknowledged", "Partially received", "Complete", "Denied", "Withdrawn").
  - `isRecordsRequestOpen(status: string): boolean`.
  - `checkRecordsTransition(from: RecordsRequestStatus, to: RecordsRequestStatus): { ok: true; reopen: boolean } | { ok: false }`.
  - `isRecordsRequestOverdue(r: { status: string; responseDueDate: Date | null }, today: string /* YYYY-MM-DD */): boolean`.
  - `recordsFolderName(custodianName: string, typeName: string): string` → `"{custodian} — {type}"`. Trimmed, whitespace collapsed, `/` and `\` replaced by `-`, capped at 120 chars. `RECORDS_ROOT_FOLDER_NAME = "Records"`.

- [ ] **Step 1: Write failing tests:**
  - `computeResponseDue(2026-10-16 (Fri), 3, BUSINESS_DAYS)` → 2026-10-21.
  - `(2026-10-17 (Sat), 3, BUSINESS_DAYS)` → 2026-10-21.
  - `(2026-10-16, 30, CALENDAR_DAYS)` → 2026-11-15.
  - `(2026-10-19 (Mon), 1, BUSINESS_DAYS)` → 2026-10-20.
  - Transitions: draft→partial ok (reopen false); partial→sent rejected; sent→denied ok; complete→sent `{ok:true, reopen:true}`; complete→withdrawn rejected (terminal → terminal).
  - Overdue: due 2026-10-17, today "2026-10-18", status sent → true; status complete → false; a null due date → false; due equals today → false.
  - `recordsFolderName(" Memorial  Hospital ", "Medical (HIPAA)")` = `"Memorial Hospital — Medical (HIPAA)"`; a slash in the name becomes `-`; output length ≤ 120.
- [ ] **Step 2:** Run `npx vitest run src/lib/records-requests`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(records): due-date, status and folder-name rules`.

### Task 3: Request CRUD, status changes, follow-up task helper

**Files:**

- Create: `src/lib/records-requests/follow-up.ts`, `src/lib/records-requests/form.ts` (form-state type + initial state; not "use server"), `src/app/actions/records-requests.ts`, `src/app/actions/records-requests.test.ts`
- Modify: `src/lib/activity-log.ts` (add `"records"` to `ActivityType`) and the dashboard `ACTIVITY_ICONS` map (find it with `grep -rn ACTIVITY_ICONS src`)

**Interfaces:**

- Consumes: Task 2; `RecordScope`, `scopeOf`, `scopeWhere`, `scopePaths` (`src/lib/record-scope.ts`); `assertScopeAccess`, `assertScopeWritable` (`src/lib/scope-access.ts`); `isAssignableUser` (`src/lib/task-assignment.ts`).
- Produces (`follow-up.ts`, all taking a Prisma `Tx`):
  - `openFollowUpTask(tx, requestId: string): Promise<void>`: creates the follow-up task if none is open.
  - `cancelFollowUpTasks(tx, requestId: string): Promise<void>`: sets open follow-up tasks to `cancelled` + `completedAt`.
  - `rollFollowUp(tx, requestId: string, opts: { actorId: string; note: string | null; today: string }): Promise<boolean>`. It is a no-op returning false when the request is not open. Otherwise it writes a `RecordsRequestFollowUp`, marks open follow-up tasks `done`, sets `nextFollowUpDate` = today + interval, calls `openFollowUpTask`, and returns true.
  - `syncFollowUpTaskOwner(tx, requestId: string, ownerId: string | null): Promise<void>`.
- Produces (actions):
  - `type RecordsRequestFormState = { status: "idle" | "ok" | "error"; errors?: Record<string, string[]>; values?: Record<string, string> }`.
  - `createRecordsRequest(scope: RecordScope, _prev: RecordsRequestFormState, fd: FormData): Promise<RecordsRequestFormState>`. Fields: `custodianContactId`, `typeId` ("" = ad hoc), `adHocTypeName`, `subject`, `description`, `dateRangeStart`, `dateRangeEnd`, `ownerId` (absent = self), `responseDueDate` (ad hoc only). Gate: `records.create`. Status starts at `draft`.
  - `updateRecordsRequest(id: string, _prev, fd): Promise<RecordsRequestFormState>`. Same fields plus `sentAt`, `responseDueDate`, `nextFollowUpDate`, `expectedUpdatedAt` (stale-guard copy as in `updateTask`). Gate: `records.edit`. It never recomputes `responseDueDate`. An owner change calls `syncFollowUpTaskOwner`.
  - `setRecordsRequestStatus(id: string, status: RecordsRequestStatus): Promise<{ ok: boolean; error?: string }>`. Gate: `records.edit`. `draft → sent` must use `markRecordsRequestSent` (error "Use Mark sent to send a request."). Entering a terminal status → `cancelFollowUpTasks`, clears `nextFollowUpDate`, and sets `receivedAt` = today for `complete`.
  - `deleteRecordsRequest(id: string): Promise<{ ok: boolean; error?: string }>`. Gate: `records.delete`. Runs `cancelFollowUpTasks`, then deletes.
  - All of them revalidate `scopePaths(scope, "records")` + `/`, and log activity of type `"records"`.

- [ ] **Step 1: Write failing integration tests:**
  - Create on a matter and on a lead: the row has the right scope and `draft` status, and the gates are asserted.
  - Ad hoc with no `adHocTypeName` → `errors.adHocTypeName`.
  - Create on a converted lead → converted-lead error.
  - **(Review Focus 2)** With an open follow-up task (seed one with `openFollowUpTask` in a tx), reassign the owner via `updateRecordsRequest` → the task's `ownerId` changes.
  - **(Review Focus 3)** On a sent request with `responseDueDate` 2026-10-21, changing `typeId` leaves `responseDueDate` unchanged.
  - `setRecordsRequestStatus` partial → sent → `{ok:false}`. Complete → the open task is cancelled, `nextFollowUpDate` is null and `receivedAt` is set. Complete → sent logs "Records request reopened".
  - **(Review Focus 4)** Delete with an open follow-up task → the task is `cancelled`. A document with `recordsRequestId` still exists, with `recordsRequestId` null.
  - A stale `expectedUpdatedAt` → `_form` error.
- [ ] **Step 2:** Run `npx vitest run src/app/actions/records-requests.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same + `npx vitest run src/app/actions/matter-access-guards.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(records): request CRUD, status changes, follow-up helpers`.

### Task 4: Mark sent, log follow-up, task-completion hook

**Files:**

- Modify: `src/app/actions/records-requests.ts`, `src/app/actions/tasks.ts` (`setTaskStatus`, `updateTask`), `src/app/actions/records-requests.test.ts`, `src/app/actions/tasks.test.ts`

**Interfaces:**

- Consumes: Task 3's `follow-up.ts`; Task 2's `computeResponseDue`.
- Produces:
  - `markRecordsRequestSent(id: string, _prev: RecordsRequestFormState, fd: FormData): Promise<RecordsRequestFormState>`. Fields: `sentAt` (default today in the actor's zone), `responseDueDate` (ad hoc / override). Gate: `records.edit`. Allowed from `draft` only.
    - It sets `responseDueDate` from the type period when the type has one; otherwise it uses the posted value or null.
    - It sets `nextFollowUpDate` = sentAt + interval.
    - It calls `openFollowUpTask`.
  - `logRecordsFollowUp(id: string, _prev, fd /* note */): Promise<RecordsRequestFormState>`. Gate: `records.edit`. Calls `rollFollowUp`.
  - **Hook:** in `setTaskStatus` and `updateTask`, after a write that moves a task carrying `recordsRequestId` from not-done to `done`, call `rollFollowUp(tx, task.recordsRequestId, { actorId, note: "Follow-up task completed", today })`. Run it in the same transaction as the status write (convert that write to `$transaction` if needed). It revalidates the request's records paths. No `tasks.create` check.

- [ ] **Step 1: Write failing tests:**
  - Mark sent on a CORA request (3 business days) sent 2026-10-16 → `responseDueDate` 2026-10-21, `nextFollowUpDate` 2026-10-23, exactly one open follow-up task titled `Follow up: Memorial Hospital — CORA` owned by the request owner.
  - Ad hoc with no due date → `responseDueDate` null.
  - Mark sent on a non-draft → error.
  - Log follow-up with fake time 2026-10-25 → one `RecordsRequestFollowUp` row, the old task `done`, a new task due 2026-11-01, still exactly one open.
  - `setTaskStatus(followUpTaskId, "done")` → the same roll happens (one new open task).
  - **(Review Focus 1)** Mark the request `complete`, then `setTaskStatus` on a reopened follow-up task to `done` → no new task (count of open follow-up tasks = 0). For an open request: done → open → done on the same task → exactly one open follow-up task afterwards.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both + `npx vitest run src/app/actions/captures.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(records): mark sent, follow-up roll, task-completion hook`.

### Task 5: Fee → Expense

**Files:**

- Modify: `src/app/actions/records-requests.ts`, `src/app/actions/records-requests.test.ts`

**Interfaces:**

- Produces: `saveRecordsFee(id: string, _prev: RecordsRequestFormState, fd: FormData /* feeEstimate, feeAmount, feePaidAt */): Promise<RecordsRequestFormState>`. Gate: `records.edit`.
  - **Matter scope with amount + paid date:**
    - With no `expenseId`: requires `matters.expense.create`, then creates the Expense (Global Constraints values) and sets `expenseId`.
    - With an `expenseId`: requires `matters.expense.edit`, then updates the Expense's amount, date and description. If that Expense has `invoiceId`, it returns `errors._form` "This fee is on an invoice and can't be changed." and changes nothing.
  - **Lead scope:** stores the fields only.
  - **Validation:** amounts must be non-negative with at most 2 decimals; `feePaidAt` requires `feeAmount`.
  - **Missing expense permission:** the friendly pre-check (`currentUserHasPermission`) returns `errors._form` "You don't have permission to add expenses." and nothing is saved.

- [ ] **Step 1: Write failing tests:**
  - Matter fee 25.00 paid 2026-10-20 → Expense: category `records`, billable, amount 25.00, date 2026-10-20, description `Records — Memorial Hospital (Medical (HIPAA))`; `expenseId` is set.
  - Editing to 30.00 updates the same Expense.
  - Invoiced Expense → error, unchanged.
  - Lead fee → no Expense.
  - No `matters.expense.create` → error, request fee unchanged.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(records): fee becomes an Expense on matters`.

### Task 6: Letters, uploads, linking

**Files:**

- Create: `src/lib/records-requests/folder.ts`
- Modify:
  - `src/lib/template-merge.ts`: `MergeContext` gains `request` and `custodian` (both nullable), plus catalog entries.
  - `src/app/actions/document-templates.ts`: preview/generate accept `opts?: { recordsRequestId?: string }`.
  - `src/app/api/documents/upload/route.ts` and `blob/blob-upload.ts`: optional `recordsRequestId` field / payload key.
  - `src/app/actions/records-requests.ts`: link/unlink.
  - Tests beside each.

**Interfaces:**

- Produces:
  - `resolveRecordsFolder(tx: Tx, request: { id: string; matterId: string | null; leadId: string | null; custodianName: string; typeName: string }): Promise<string>`. Returns the folder id. Finds or creates root `Records`, then the child `recordsFolderName(...)`, collision-suffixed with `nextAvailableFolderName` (`src/lib/folder-tree.ts`).
  - Merge fields (exact keys):
    - `request.subject`, `request.description`, `request.type`, `request.dateRangeStart`, `request.dateRangeEnd`, `request.responseDueDate`, `request.sentDate`
    - `custodian.name`, `custodian.organization`, `custodian.address`, `custodian.email`, `custodian.phone`
    - Null outside a request (rendered as the engine's "not on file" placeholder).
  - `previewDocumentFromTemplate(templateId, scope, opts?)` / `generateDocumentFromTemplate(templateId, scope, opts?)`.
    - With `recordsRequestId`: the request must be in `scope`, else `{ ok: false, error: "Records request not found." }`.
    - Generate files into `resolveRecordsFolder`, sets `recordsRequestId` + `recordsRequestRole: "request_letter"`, and also requires `records.edit`.
  - **Upload routes:**
    - An optional `recordsRequestId` field (multipart: must precede file parts; blob: payload key). The request must belong to the upload scope, else 400 `"Records request not found in this matter or intake."`, before any byte is stored or any token is issued.
    - When set and no `folderId` is sent, the folder = `resolveRecordsFolder`.
    - Created documents get `recordsRequestId` + role `received_records`.
    - This also requires `records.edit`.
  - `linkRecordsDocuments(id: string, documentIds: string[]): Promise<{ ok: boolean; error?: string }>`: documents must share the request's scope (cross-scope → `SAME_SCOPE_ERROR` from `record-scope.ts`), and sets role `received_records`.
  - `unlinkRecordsDocument(documentId: string): Promise<{ ok: boolean }>`: clears both columns and never deletes the document. Gate: `records.edit`.

- [ ] **Step 1: Write failing tests:**
  - `resolveRecordsFolder` twice → same folder id. A pre-existing non-records root "Records" is reused. A child-name collision gets " (2)" only when the existing child isn't the request's own.
  - Generate with `recordsRequestId` → the Document is in `Records/Memorial Hospital — CORA` with role `request_letter`, and the merged `{{custodian.name}}` = "Memorial Hospital".
  - **(Review Focus 5)** Generate with a request from another scope → `{ok:false}`.
  - Multipart upload with `recordsRequestId` → the document has role `received_records` and is in the request folder.
  - Upload with a request id from another scope → 400 and `storeFile` not called.
  - The same check on the blob token path.
  - Link a lead document to a matter request → refused. Unlink keeps the document.
- [ ] **Step 2:** Run the affected test files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same + `npx vitest run src/app/api/documents src/app/actions/document-templates.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(records): request letters, records uploads, document linking`.

### Task 7: Request types settings page

**Files:**

- Create: `src/app/actions/records-request-types.ts` + test, `src/app/(dashboard)/settings/records-types/page.tsx` + `page.test.tsx`, `src/components/records-requests/request-type-editor.tsx`
- Modify: `src/components/settings/settings-nav.tsx` (Firm section, after "Document templates": `{ href: "/settings/records-types", label: "Records request types" }`, shown only with `records.types.manage`; follow how the neighbouring gated entries are filtered), `src/lib/queries/records-requests.ts` (create it with `listRecordsRequestTypes`)

**Interfaces:**

- Produces:
  - `createRecordsRequestType(_prev, fd)` / `updateRecordsRequestType(id, _prev, fd)`. Fields: `name` (1–80, unique among active, case-insensitive), `responseAmount` ("" = none, else 1–365), `responseUnit` (required with an amount), `followUpDays` (1–90), `defaultTemplateId` ("" = none; must be an active template).
  - `setRecordsRequestTypeActive(id, active: boolean)` and `moveRecordsRequestType(id, direction: "up" | "down")`.
  - All gated `records.types.manage`, activity-logged (`matterId: null`), revalidating `/settings/records-types`.
  - `listRecordsRequestTypes(opts: { activeOnly: boolean }): Promise<RecordsRequestTypeRow[]>`, ordered by sortOrder then name.
  - Page: follows the `/settings/practice-areas` layout (list + create + edit + archive toggle); notFound without the key.

- [ ] **Step 1: Write failing tests:**
  - Create "Employment records", 30, CALENDAR_DAYS, 7 → row.
  - Amount without unit → `errors.responseUnit`.
  - A duplicate active name → `errors.name`.
  - Archive hides it from `listRecordsRequestTypes({activeOnly:true})`.
  - Page without the key → notFound.
- [ ] **Step 2–4:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 5: Commit** `feat(records): request types settings`.

### Task 8: Records tab, composer and detail panel (both scopes)

**Files:**

- Modify: `src/lib/queries/records-requests.ts`
- Create:
  - `src/components/records-requests/records-tab.tsx` (server)
  - `new-request-composer.tsx` (client)
  - `request-detail-panel.tsx` (client; modal shell idiom of `src/components/calendar/event-detail-modal.tsx`, closed by removing `?request=`)
  - `request-row.tsx`
  - `src/app/(dashboard)/matters/[id]/records/page.tsx` + test
  - `src/app/(dashboard)/intake/[id]/records/page.tsx` + test
- Modify: `src/components/matters/matter-tabs.tsx` (add `{ slug: "records", label: "Records" }` after Documents; hide it without `records.view` via a `canViewRecords` prop, as `canViewBilling` does) and its layout caller; `src/components/intake/intake-tabs.tsx` (after Documents, same gating)

**Interfaces:**

- Produces:
  - `getRecordsRequests(scope: RecordScope, tz: string): Promise<RecordsRequestRow[]>`. Row fields: `id`, `status`, `subject`, `custodianName`, `typeName` (type name or ad hoc), `sentAt`, `responseDueDate`, `nextFollowUpDate`, `daysUntilDue: number | null` (`daysUntilDateOnly`), `isOverdue`, `feeAmount: string | null`, `letterCount`, `recordsCount`, `ownerInitials`.
  - `getRecordsRequestDetail(scope: RecordScope, id: string): Promise<RecordsRequestDetail | null>`: null when the id isn't in the scope. Adds `description`, date range, `typeId`, owner, fee fields, `expenseLocked: boolean`, `followUps` (newest first), linked documents (id, name, role, href via `scopeBasePath`), `updatedAt`.
  - `RecordsTab({ scope, requestParam, writable }: { scope: RecordScope; requestParam: string | null; writable: boolean })`:
    - Status groups in `RECORDS_REQUEST_STATUSES` order.
    - Row due badge: "{n}d left", "Due today" or "{n}d overdue".
    - The composer shows when `writable && records.create`. Panel actions are gated by `records.edit` / `records.delete` / `documents.upload`.
    - The panel's fee section shows only on matters when `matters.expense.create` is held; on leads it stores without the expense permission.
  - Panel history: the follow-up log (newest first) plus status changes (`sentAt`, `receivedAt`) **are** the request's activity section. A per-request ActivityLog feed would need a request FK on ActivityLog, which is out of scope; ADR-047 records this.
  - After an upload or link completes in the panel, show inline "Mark partial" / "Mark complete" buttons (hidden when the status is already that or terminal). They never change status automatically.
  - Pages: `requireUser`, plus `assertMatterAccess` on the matter route only, then `records.view` (notFound without it). The intake page passes `writable = stage !== "converted"` and shows the existing converted banner linking to `/matters/{convertedMatterId}/records`.
  - The custodian picker reuses the existing contact search used by the party/attendee pickers (`grep -rn "searchContacts\|attendee-search" src/app/actions`) and quick-creates a contact with type `medical_provider` or `government` through the existing contact create action.

- [ ] **Step 1: Write failing tests:**
  - Query: a cross-scope id → null. Rows are grouped and `isOverdue` computed (fake today).
  - Matter page: without `records.view` → notFound; with it, renders `RecordsTab` with the matter scope.
  - Intake page: converted → banner href `/matters/m_9/records` and `writable=false`.
  - Composer: an ad hoc pick reveals the type-name and due-date inputs and posts `typeId=""`.
  - Panel: Mark sent posts to `markRecordsRequestSent`; the delete control is hidden without `records.delete`.
  - Panel: after a mocked successful upload, the "Mark complete" button appears and posts `setRecordsRequestStatus(id, "complete")`.
- [ ] **Step 2–4:** Run → FAIL. Implement. Run → PASS (+ `"src/app/(dashboard)/matters/[id]"`, `"src/app/(dashboard)/intake"`).
- [ ] **Step 5: Commit** `feat(records): Records tab, composer and detail panel`.

### Task 9: Conversion, contact merge, dashboard card, search

**Files:**

- Modify:
  - `src/app/actions/leads.ts` (`convertLeadToMatter`) + test
  - `src/app/actions/contacts.ts` (`mergeContacts`) + test
  - `src/lib/dashboard-prefs.ts` (`DASHBOARD_CARD_KEYS` += `"records"`, label "Records to chase", right column), `src/app/(dashboard)/page.tsx`, `src/lib/queries/records-requests.ts`
  - `src/lib/queries/search.ts` + test, and the search result UI's group-label map (`grep -rn "\"time\":" src/components/search`)

**Interfaces:**

- Produces:
  - **Conversion** (inside the transaction, after the existing task/document re-homes):
    1. `recordsRequest.updateMany({ where: { leadId }, data: { matterId, leadId: null } })`.
    2. For carried requests with `feeAmount` and `feePaidAt` set and no `expenseId`, create the Expense (Task 5 values, `loggedBy` = converter) and set `expenseId`.

    Post-commit logs: "N intake records requests carried forward" and "N records fees added as expenses" (singular forms when 1).

  - **Contact merge:** `tx.recordsRequest.updateMany({ where: { custodianContactId: loserId }, data: { custodianContactId: survivorId } })` before the loser is removed.
  - `getMyRecordsToChase(tz: string): Promise<RecordsChaseItem[]>`. The viewer's (`ownerId`) open requests where `isOverdue` or `nextFollowUpDate` ≤ today + 7. Matter rows go through the optional matter-access clause. Ordered: overdue first, then the earliest of the due/follow-up dates. Item fields: `id`, `subject`, `custodianName`, `href` (`${scopeBasePath(scope)}/records?request=${id}`), `label` ("2d overdue" | "Follow up today" | "Follow up in 3d"), `context` (matter name or "Intake · {lead}").
  - The card renders only with `records.view` and the card visible.
  - **Search:** group type `"records_request"`, label "Records requests". It matches subject, description and custodian name. The access clause follows `searchNotes`. Href and context are as above. Gated on `records.view`.

- [ ] **Step 1: Write failing tests:**
  - A converted lead with a request (paid fee 15.00 on 2026-10-10) plus its follow-up task and a letter document → the request is on the matter with `leadId` null, an Expense of 15.00 is linked, the task is on the matter, and both log titles are exact.
  - Merge → the request's custodian = survivor.
  - Chase query: overdue sorts before a follow-up in 3d, a complete request is excluded, another owner's request is excluded.
  - Search for a custodian name returns a hit with the intake href and context `Intake · Test Lead`. Without `records.view`, there's no records group.
- [ ] **Step 2–4:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 5: Commit** `feat(records): conversion carry-forward, merge, dashboard card, search`.

### Task 10: Docs + full verification

**Files:**

- Modify: `docs/DECISIONS.md` (ADR-047), `docs/FEATURES.md`, `docs/ARCHITECTURE.md` (new action files, `src/lib/records-requests/`, `src/components/records-requests/`), `docs/UI_PATTERNS.md` (URL-driven request detail panel)

ADR-047 content:

- a dedicated model over task metadata or a generic engine
- the rolling single follow-up task and why the hook rolls it
- the panel's history = follow-up log + dates (no per-request ActivityLog FK)
- follow-up tasks are exempt from `tasks.create` (an exception to ADR-025)
- fee → Expense on matters immediately, on leads at conversion
- business days skip weekends only
- seeded types are editable starting points, not legal advice

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npx vitest run && npm run check:migrations`. Expected: 0 errors, 0 warnings, all pass, migrations match.
- [ ] **Step 3: Commit** `docs(records): ADR-047 and feature docs`.
- [ ] **Step 4: Ship gate (controller + user, not the implementer):** apply the migration to the local dev DB, then ask the user to run the prod `migrate status` / `migrate deploy` before pushing.
