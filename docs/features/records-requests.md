# Records requests

Tracks requests for records (medical, CORA/CGIA, police, employment) to custodians on matters and intake leads, from draft to complete, with chase reminders, statutory due dates and fees. Shipped 2026-10-18 and hardened since.
Related: [ADR-047](../decisions/047-records-requests-are-a-dedicated-model-with.md), [ADR-046](../decisions/046-intake-documents-share-document-and-documentfolder-scoped.md), [design spec](../superpowers/specs/2026-10-18-records-requests-design.md), [intake.md](intake.md), [PERMISSIONS.md](../PERMISSIONS.md)

## Open work
Deferred ideas (none scheduled, all P2):
- [ ] **Per-item completeness tracking** — which record types or date ranges arrived.
- [ ] **HIPAA authorization tracking and expiry.**
- [ ] **Holiday-aware business days** — today only weekends are skipped.
- [ ] **Send requests by email or fax from the app.**
- [ ] **PDF/DOCX letter output** — letters are `.md` like other template output.
- [ ] **Firm-wide /records page** — the dashboard card covers it for now.

## Shipped
- [x] **Records requests (matter and intake `/records` tabs)** (2026-10-18) — requests to custodians on a matter or lead.
  - **Types:** firm-defined (statutory response period, chase interval, default letter template), managed in settings (`records.types.manage`); seeded types (Medical HIPAA 30 calendar days, CORA 3 business, Police report 3 business, Employment 30 calendar) are editable starting points, not legal advice. Ad hoc type allowed (name required; no statutory period unless a due date is typed).
  - **Follow-ups:** each open request has exactly one rolling auto-created follow-up task that rolls on completion (via Log follow-up or completing the task anywhere).
  - **Status:** draft -> sent -> acknowledged -> partial -> complete, with terminal denied / withdrawn; any non-terminal can move to any later one; terminal states can reopen (restarts the chase). Complete/denied/withdrawn cancel the open follow-up task. Overdue is derived (due date past, status not terminal).
  - **Documents:** template letters and uploads file under `Investigation/Records Requests/{custodian} — {type}/Request documents` or `/Responsive documents`; the page has a section and upload area for each. Link-existing tags documents in the same scope; unlinking never deletes a file.
  - **Fee:** stored on the request. On a matter a paid fee creates an Expense (category `records`) and is read-only once invoiced; on a lead the Expense is created at conversion. Fee data is gated server-side.
  - **Custodians** can be quick-created from the composer.
  - **Detail page:** each request has its own page (`.../records/[requestId]`); old `?request=` links are not redirected. Shared due badge module (`dueBadge`).
  - **Elsewhere:** conversion carries requests forward; contact merge re-points requests where the contact is custodian; a "Records to chase" dashboard card (viewer's overdue or due-within-7-days) and global search cover them.
  - Permissions: `records.view/create/edit/delete`, `records.types.manage` (see `src/lib/permissions.ts`); matter requests sit behind `assertMatterAccess`.
  - **Generated folders (2026-10-18):** request folders carry a `systemKind` and a link to their request, show a "Records request" badge linking back, and cannot be renamed, moved or deleted (nor can their ancestors be deleted); deleting the request unprotects them (ADR-048).

## Notes
- Business days skip Saturdays and Sundays only; due dates are always editable. `computeResponseDue` lives in `src/lib/records-requests/due-date.ts` (calendar days: sent + N; business days: day 1 is the first weekday after sending).
- Follow-up tasks do NOT require `tasks.create`: they are a system side effect of `records.create/edit`, an exception to the ADR-025 capture rule (recorded in ADR-047).
- Fee-to-Expense also needs `matters.expense.create/edit`; letters and uploads also need `documents.upload`.
- Stale edits use the `expectedUpdatedAt` guard. Deleting a request keeps linked documents, tasks and expenses (FKs SetNull).
- Hardening after launch: follow-up reopen guard, lock order, draft/reopen rules, atomic document link, real-DB upload-tag tests, late `recordsRequestId` rejected on uploads, preview needs `records.view`, delete skips request-page revalidation. The latest change (1ecbeda) splits request documents from responsive documents.
- Data model, lifecycle and merge-field details: see the design spec and ADR-047. Merge fields added for templates: `request.*` and `custodian.*`.
