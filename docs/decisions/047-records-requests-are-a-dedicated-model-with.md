# ADR-047: Records requests are a dedicated model with a rolling follow-up task

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Firms request records (medical, government, employment) from custodians on matters and intake leads, with statutory response periods, repeated chasing, template letters and fees. Intake was already tracking "request records" as ordinary tasks, which lost status, dates and fees.

**Decision:**
- **Dedicated models over task metadata or a generic engine.** `RecordsRequest` and a firm-defined `RecordsRequestType` (statutory response period, chase interval, letter template) hold status, custodian, dates and fee. Scope is exactly one of matter or lead, resolved through `RecordScope`; requests are carried forward when a lead converts.
- **One rolling follow-up Task.** Each open request has a single auto-created follow-up task. Completing it rolls the next one (today + interval) in the same transaction, via the hook in `setTaskStatus` / `updateTask`, rather than pre-creating a chain. The helpers in `src/lib/records-requests/follow-up.ts` row-lock the request (`SELECT … FOR UPDATE`) and the roll is conditional, so concurrent "done" clicks roll once. **Lock order is request row first, then task rows** everywhere (task status/edit hooks, roll, cancel, and lead conversion, which locks the lead's requests right after the lead claim) so concurrent flows cannot deadlock. Moving a follow-up task back out of done/cancelled is refused when the request is closed or another follow-up task is already open, keeping "at most one open follow-up".
- **Status machine.** Forward-only among non-terminal states; any non-terminal to terminal; terminal to non-terminal is a reopen (logged, restarts the chase at today + interval); same-to-same and terminal-to-terminal are rejected; draft to sent happens only through Mark sent (`src/lib/records-requests/status.ts`). A draft leaves only by Mark sent or by closing as denied/withdrawn (never straight to acknowledged/partial/complete), and drafts are not chased: no follow-up task, and Log follow-up is refused until the request is sent. A terminal request reopens by `sentAt`: never sent, only to draft (no task); sent, only to sent-or-later (never draft).
- **History = follow-up log + dates.** The request detail page shows the follow-up log and sent/received dates. There is no per-request ActivityLog FK or feed; actions still write ActivityLog entries (type `records`, filed under the Documents bucket in filters).
- **Follow-up tasks are exempt from `tasks.create`.** An exception to ADR-025: they are a side effect of `records.*` actions, not a user creating a task.
- **Fee to Expense.** On matters the fee creates an Expense immediately; on leads it is created at conversion. A $0 fee never creates one; clearing a fee while an Expense is linked is refused; an invoiced Expense locks the fee. Fee visibility on matters requires `matters.expense.view` (lead fees show with `records.view`); editing needs `records.edit` plus `matters.expense.view` and `matters.expense.create/edit` on matters. Scope and expense-ness are decided from the row re-read after the request lock, so a fee save racing a conversion always ends with an Expense for a paid fee.
- **Letters and uploads** live in the folder `Records/{custodian} — {type}`; ownership is inferred from the folder's tagged documents, including those in its two fixed subfolders. `recordsRequestId` must precede file parts in an upload (400 otherwise).
- **Request vs responsive documents (2026-10-18).** The request folder has two child folders, `Request documents` (role `request_letter`) and `Responsive documents` (role `received_records`), created on first use (`resolveRecordsRoleFolder`; names and the role mapping live in `src/lib/records-requests/roles.ts`). Stored roles are unchanged (no migration); only labels and folders differ. Uploads take an optional `recordsRole` (multipart: must precede file parts; blob: payload key; invalid is a 400; default `received_records`). `linkRecordsDocuments` takes a role, may switch the role of a document already on the request, and never moves files. Resolving a role folder also moves this request's flat documents into the matching subfolder by role.
- **Custodian quick-create** (`createCustodianContact`, medical_provider or government, non-redirecting) needs `records.create` + `contacts.create`.
- **Upload edge cases.** Previewing a letter for a request needs `records.view`. A lead upload rerouted to the converted matter keeps the file and drops the records tag only if the request no longer matches.
- **Detail is its own page (2026-10-18).** The request detail moved from a `?request=` modal on the Records tab to `.../records/[requestId]`; old `?request=` links are not redirected.
- **Business days skip weekends only** (no holiday calendar). Seeded types are editable starting points, not legal advice.

**Trade-offs:**
- (+) Status, dates and fees are queryable; the dashboard card and search are simple queries
- (+) Exactly one open follow-up; no task pile-up and no cron
- (-) Detail history is thinner than a full audit feed
- (-) Weekend-only business days can be a day off around holidays
- (-) The follow-up exemption is a second path that creates tasks outside `tasks.create`

**Known follow-ups (parked):**
- The template-generate path takes no lead `FOR SHARE` lock or re-check, so a letter generated in the millisecond window of a conversion can land on the converted lead (still visible and re-generatable).
- `saveRecordsFee` compares against the request's stored fee, so an Expense edited on the Time tab can be reverted by a later fee save.
