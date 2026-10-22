# Records requests — design

**Date:** 2026-10-18
**Status:** Draft for review
**Depends on:** intake documents (`2026-10-18-intake-documents-design.md`), which ships first.

## Goal

Track requests for records (medical, CORA/CGIA, police, employment, and so on) from draft to complete on matters and intake leads. The tracker shows at a glance:

- where each request stands
- when to chase it, with chase reminders as auto-created tasks
- the legal response deadline
- what it cost

Request letters come from the document-template system and received records go through the document upload system. On lead conversion, everything carries to the matter.

### What the user decided

- Track status + follow-up dates **and** the statutory response deadline **and** cost.
- Requests live on matters **and** intake leads, and carry forward on conversion.
- Request types are **firm-defined** (with response periods), **plus an ad hoc option**.
- Follow-ups are **auto-created tasks**.
- On leads, letters and records are stored as **lead documents** (prerequisite spec).
- The fee is stored **on the request**. It becomes a real **Expense** immediately on a matter, and at conversion on a lead.
- Approach: a dedicated model (not task metadata, not a generic request engine).

### Assumptions (user to correct)

- The custodian is an existing Contact (typically `medical_provider` or `government`).
- Business days skip Saturdays and Sundays only. There is no holiday calendar today, so a period spanning a court holiday is off by that day. Due dates are always editable.

## Data model

### `RecordsRequestType` (firm-configured)

| Field                           | Type                                                       | Notes                                    |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| id                              | cuid                                                       |                                          |
| name                            | String                                                     | "Medical (HIPAA)", "CORA", …             |
| responseAmount                  | Int?                                                       | null = no statutory period for this type |
| responseUnit                    | enum `RecordsPeriodUnit` (CALENDAR_DAYS \| BUSINESS_DAYS)? | required when amount is set              |
| followUpDays                    | Int                                                        | chase interval, default 7, 1–90          |
| defaultTemplateId               | String?                                                    | FK DocumentTemplate, SetNull             |
| isActive                        | Boolean                                                    | archive hides it from pickers            |
| sortOrder, createdAt, updatedAt |                                                            |                                          |

Seeded starter types (editable or deletable): Medical (HIPAA) 30 calendar; CORA 3 business; Police report 3 business; Employment 30 calendar. The seed values are starting points, not legal advice.

### `RecordsRequest`

| Field                             | Type            | Notes                                                                                 |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| id                                | cuid            |                                                                                       |
| matterId / leadId                 | String?         | **exactly one** (`scopeOf`). Lead conversion re-homes                                 |
| custodianContactId                | String          | FK Contact, Restrict (a contact with requests can't be hard-deleted; merge re-points) |
| typeId                            | String?         | FK RecordsRequestType, SetNull. Null = ad hoc                                         |
| adHocTypeName                     | String?         | required when typeId is null                                                          |
| subject                           | String          | e.g. "Records for Jane Doe"                                                           |
| description                       | String?         | what is being asked for                                                               |
| dateRangeStart / dateRangeEnd     | DateTime?       | date-only (ADR-012)                                                                   |
| status                            | String          | see lifecycle                                                                         |
| sentAt                            | DateTime?       | date-only                                                                             |
| responseDueDate                   | DateTime?       | date-only; computed on send from the type, manual for ad hoc; always editable         |
| nextFollowUpDate                  | DateTime?       | date-only                                                                             |
| receivedAt                        | DateTime?       | date-only; set on Complete                                                            |
| ownerId                           | String?         | FK User, SetNull. Follow-up tasks are assigned to them                                |
| feeEstimate / feeAmount           | Decimal(14,2)?  | ADR-036 money                                                                         |
| feePaidAt                         | DateTime?       | date-only                                                                             |
| expenseId                         | String? @unique | FK Expense, SetNull                                                                   |
| createdById, createdAt, updatedAt |                 |                                                                                       |

Indexes: matterId, leadId, status, ownerId, (status, nextFollowUpDate), (status, responseDueDate).

### Links out (new nullable FKs, SetNull)

- `Document.recordsRequestId` + `Document.recordsRequestRole` (`request_letter` | `received_records`).
- `Task.recordsRequestId`: follow-up tasks.
- `RecordsRequestFollowUp` (id, requestId Cascade, userId, occurredAt, note, createdAt): the follow-up history log.

## Lifecycle

Statuses: `draft` → `sent` → `acknowledged` → `partial` → `complete`, with terminal side-exits `denied` and `withdrawn`. Any non-terminal status can move to any later one. Reopening a terminal status is allowed (`records.edit`) and is logged.

- **Mark sent** (from draft): set `sentAt` (default today, editable). If the type has a period, compute `responseDueDate` with `computeResponseDue(sentAt, amount, unit)`; for ad hoc, use the due date the user typed, if any (it's optional; with none the request shows "No statutory deadline"). Set `nextFollowUpDate = sentAt + followUpDays`, using the type's interval or 7 for ad hoc. Create the follow-up task.
- **Follow-up task:** title `Follow up: {custodian} — {type}`, due `nextFollowUpDate`, owner = request owner, `recordsRequestId` set, same scope as the request. At most one open follow-up task per request.
- **Log follow-up** (button, or marking the follow-up task done): write a `RecordsRequestFollowUp` row and push `nextFollowUpDate` forward by the interval from today. Close the current task as done and create the next one. Completing the task from anywhere (dashboard, Tasks tab) triggers this through a hook in `setTaskStatus` / `updateTask` when the task carries a `recordsRequestId` and the request is still open. Log follow-up closes the task through the same shared helper, not via the hook, so one follow-up creates exactly one next task.
- **Complete / denied / withdrawn:** set `receivedAt` (complete only), clear `nextFollowUpDate`, and cancel any open follow-up task.
- **Overdue** is derived: `responseDueDate < today` (viewer's zone, date-only) and status not complete/denied/withdrawn.

`computeResponseDue` is a pure, tested function in `src/lib/records-requests/due-date.ts`. Calendar days: due = `sentAt` + N days. Business days: day 1 is the first weekday after `sentAt`, and Saturdays and Sundays are skipped.

## Templates

- Merge catalog additions in `src/lib/template-merge.ts`: `request.subject`, `request.description`, `request.type`, `request.dateRangeStart`, `request.dateRangeEnd`, `request.responseDueDate`, `request.sentDate`, `custodian.name`, `custodian.organization`, `custodian.address`, `custodian.email`, `custodian.phone`. Templates generated outside a request render these as the visible "not on file" placeholder.
- **Generate letter** on the request: template picker defaulting to the type's `defaultTemplateId`, then the existing preview → generate flow. The output is a Document in the request's scope, in the request's folder (below), with `recordsRequestId` and role `request_letter`. The output stays `.md` like today's template output.

## Received records

- **Upload records** on the request uses the existing uploader into the request's folder: `Records / {custodian} — {type}` under the scope's document root, created on first use. The folder name is cleaned and collision-suffixed. Uploaded files get `recordsRequestId` and role `received_records`.
- **Link existing:** pick documents already in the same scope and tag them `received_records`. Unlink clears the tag; it never deletes the file.
- After an upload or link, the UI offers "Mark partial" / "Mark complete". It doesn't change the status automatically.

## Fee

- Fields: estimate, amount, paid date. On a **matter**, saving with an amount and a paid date creates an Expense (category `records`, billable, date = paid date, description `Records — {custodian} ({type})`, `loggedBy` = actor) and sets `expenseId`. This needs `matters.expense.create`; editing the fee updates the Expense unless it's invoiced (`invoiceId` set), in which case the fee fields are read-only with a note.
- On a **lead**, the fee is stored only. In `convertLeadToMatter`, every carried request with an amount and a paid date and no `expenseId` gets its Expense created in the same transaction, and conversion activity-logs "N records fees added as expenses".

## Conversion

Inside `convertLeadToMatter`'s transaction: re-home requests (`matterId` set, `leadId` cleared), then fees → Expenses as above. Their follow-up tasks re-home through the existing task re-homing, and their documents through the intake-documents re-homing. The activity log gets "N intake records requests carried forward".

## UI

- **Records tab** on matters (`/matters/[id]/records`) and on intake (`/intake/[id]/records`):
  - The list is grouped by status. Each row: custodian, type, sent date, due badge ("3d left" / "2d overdue"), next follow-up, fee chip, file counts.
  - **New request** composer: custodian picker (existing contacts, or quick-create with type `medical_provider` / `government`), type or "Other (ad hoc)", subject, description, date range, owner (default self).
- **Request detail panel** (URL-driven `?request=<id>`, the matter Events `?event=` pattern):
  - status stepper and actions
  - editable dates
  - Letter section, Records section, Fee section
  - follow-up history + Log follow-up
  - activity
- **Settings → Records request types:** list with create, edit, archive; the standard Settings section layout.
- **Dashboard card "Records to chase":** the viewer's open requests (owner = viewer) that are overdue or have a follow-up within 7 days, linking to the request.
- Tabs added to `matter-tabs.tsx` and `intake-tabs.tsx`. Global search covers requests (subject, description, custodian name).

## Permissions

New keys in `src/lib/permissions.ts` (new "Records requests" group) plus `permissions.test.ts`:

- `records.view`: see Records tabs, the dashboard card and search hits
- `records.create`: new requests
- `records.edit`: status, dates, owner, fields, follow-ups, link/unlink documents
- `records.delete`: delete a request (linked documents, tasks and expenses are kept; their FKs SetNull)
- `records.types.manage`: the settings page

Existing gates still apply on top:

- `documents.upload` to generate a letter or upload records.
- `matters.expense.create` / `matters.expense.edit` when a fee creates or updates an Expense.

The auto-created follow-up tasks do **not** require `tasks.create`. They're a system side effect of `records.create` / `records.edit`, not a capture the user chose, so ADR-025's capture rule doesn't apply; the ADR will record this exception. Matter requests sit behind `assertMatterAccess`.

## Server actions

`src/app/actions/records-requests.ts`: `createRecordsRequest(scope, …)`, `updateRecordsRequest`, `setRecordsRequestStatus`, `markRecordsRequestSent`, `logRecordsFollowUp`, `linkRecordsDocuments` / `unlinkRecordsDocument`, `saveRecordsFee`, `deleteRecordsRequest`. `src/app/actions/records-request-types.ts`: create / update / archive / reorder. All are permission-gated, activity-logged (lead-scoped rows firm-wide) and revalidate via `scopePaths(scope, "records")` + `/`. Letter generation and upload reuse the template and upload paths with a `recordsRequestId` parameter.

## Error handling

- Ad hoc without a type name → form error.
- Mark sent on an ad hoc request with no due date → allowed (see Lifecycle).
- Custodian contact inactive or merged → the merge re-points requests (add `RecordsRequest` to `mergeContacts`).
- Stale edits use the `expectedUpdatedAt` guard (the `updateTask` pattern).
- An invoiced fee → read-only.

## Testing

- **Unit:** `computeResponseDue` (calendar and business days, weekend starts, Friday sends), status transition rules, the derived overdue rule, the folder-name builder.
- **Integration:** create in both scopes; mark sent computes the due date and creates exactly one follow-up task; completing the follow-up task from `setTaskStatus` rolls the next one; complete cancels the open task; the fee creates and updates an Expense, and an invoiced fee is locked; conversion re-homes the request, task and documents and turns a paid fee into an Expense; delete keeps linked documents; contact merge re-points.
- **Permissions:** each action asserts its key; `matter-access-guards` covers the new actions.
- **Page:** Records tab gating in both scopes, the converted-lead banner, the dashboard card.

## Docs

SCHEMA_NOTES (models + changelog), ADR-047 (records requests: dedicated model, rolling follow-up task, fee → Expense timing), FEATURES, PERMISSIONS (new group), UI_PATTERNS (request detail panel, if reusable), ARCHITECTURE (new action files).

## Out of scope (possible later iterations)

- Per-item completeness tracking (which record types or date ranges arrived)
- HIPAA authorization tracking and expiry
- Holiday-aware business days
- Sending requests by email or fax from the app
- PDF/DOCX letter output
- A firm-wide /records page (the dashboard card covers it for now)
