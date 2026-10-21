# Email record filing: every sent email belongs to a matter or a lead

**Date:** 2026-10-21
**Tier:** Full (schema change, scope rules, lead → matter data movement)
**Status:** Design approved in chat; awaiting spec review

Sub-project 1 of 2. Sub-project 2 (attachments on send) builds on this and
gets its own spec.

## Intent

The app is not a free-form email client. Every email sent from the app is
tied to a matter or a lead, so sent mail always has a home and a reply
categorizes the whole thread. Leads and matters behave the same way; only
the pathways differ.

Out of scope:
- Automatic matching of email to records by contact address. Contacts
  (records custodians, opposing counsel) span many matters, so matching is
  left to a future categorizer. The lead Communication tab drops its
  contact-address matching for this reason.
- Mail sent directly in Gmail (outside the app). It still syncs in unfiled.
- Mailbox visibility. Mailboxes stay personal (`visibleEmailThreadWhere`):
  a record's Communication tab shows the viewer's own threads filed there.
- SMS / calls on the lead tab (still matched by contact).

## Data model

Expand-only migration (safe under ADR-058 auto-apply), no backfill.

- `EmailThread.leadId String?`: relation to `Lead` (`onDelete: SetNull`,
  matching `matterId`), `@@index([leadId])`. App-enforced invariant: AT
  MOST ONE of (`matterId`, `leadId`); neither = unfiled (inbound only).
  Schema comment notes that a future lead-delete path must re-home or
  refuse threads with app-sent mail; `SetNull` is only a fallback (no
  lead-delete action exists today).
- `EmailMessage.sentFromApp Boolean @default(false)`: set true only by
  `persistSentMessage`. Sync never writes it (sync updates provider-owned
  columns only; our own upsert uses `update: {}`). Older sent messages
  stay `false`.

## Filing rules

`setEmailThreadRecord(threadId, scope: RecordScope | null)` in
`src/app/actions/email-filing.ts` replaces `setEmailThreadMatter`.

- Gate: `communication.file_email`. Owner-only via
  `visibleEmailThreadWhere`; anyone else gets "Thread not found", nothing
  written or logged.
- `assertScopeAccess` on the thread's current record (if any) and on the
  target. `assertScopeWritable(target)` refuses a converted lead.
- Target must exist (stale picker values). Same record → no-op, nothing
  logged.
- Write sets one of `matterId` / `leadId` and clears the other in one
  update.
- Unfile (`null`) is refused when any message on the thread has
  `sentFromApp = true`: "This thread has email sent from the app, so it
  must stay filed. Move it to another matter or lead instead." Moving is
  always allowed.
- Activity: "Email removed from matter/lead" on the record it left, then
  "Email filed to matter/lead" on the target (`logActivity` with
  `matterId` or `leadId`).
- Revalidates the inbox, both records' Communication tabs.

## Record picker

One shared component replaces `file-to-matter-picker.tsx`.

- Searchable list grouped into **Matters** (`getFilingMatterOptions`:
  access-scoped, open, pinned first) and **Leads** (new
  `getFilingLeadOptions`: access-scoped via lead access, any stage except
  `converted`; declined and on-hold leads stay listed, since a decline
  letter is still lead mail).
- Value is a `RecordScope`.
- Used by the thread reader filing control, compose, and the reply
  composer on an unfiled thread. The filing control hides "Unfile" when
  the thread has app-sent mail (the server enforces it regardless), so
  the reader query exposes a `hasAppSentMail` flag.

## Compose

- Inbox composer: required "Matter or lead" field at the top; Send is
  disabled until it is set.
- New Compose entry points on the matter Communication tab (email
  channel) and the lead Communication tab, prefilled with that record;
  the field stays editable.
- `sendEmail(accountId, { …, scope })`: `scope` required. Before calling
  Gmail: `assertScopeAccess(scope)` and `assertScopeWritable(scope)`;
  nothing reaches Gmail if the record is invalid.
- After Gmail accepts, `persistSentMessage` sets `sentFromApp = true` and
  files a newly created thread to the scope.
- Edge case: Gmail may add the send to an existing Gmail thread. If that
  local thread is unfiled, file it to the scope. If it is filed to a
  different record, keep its filing (never move silently) and return a
  notice on the success result: "Added to an existing thread filed to X."
  The composer shows it and clears the draft as on any success.

## Reply

- Filed thread: unchanged; activity logs on the thread's matter or lead.
- Unfiled thread: the reply composer shows the required record picker.
  `replyToThread(threadId, { …, scope })` files the thread first (same
  rules as `setEmailThreadRecord`, including `communication.file_email`),
  then sends. If filing succeeds and the send fails, the thread stays
  filed (the user chose the record) and the draft is kept.
- Without `communication.file_email`, the reply composer on an unfiled
  thread shows "Ask someone who can file email to file this thread
  first." and the action refuses.
- `scope` on a filed thread is ignored (the thread's record wins).

Activity "Email sent" / "Email reply sent" logs on the record (matter or
lead). Revalidation adds `/intake/[id]/communication`.

## Lead conversion

In the existing conversion transaction in `src/app/actions/leads.ts`,
beside the task/event re-homes:

```ts
const carriedThreads = await tx.emailThread.updateMany({
  where: { leadId },
  data: { matterId: matter.id, leadId: null },
});
```

- Moves every user's threads filed to the lead (filing belongs to the
  record, not the mailbox).
- `carriedEmailThreadCount` is returned and, when > 0, adds a line such
  as "3 email threads carried over" to the conversion timeline entry.
- After conversion, the lead is read-only for email: `assertScopeWritable`
  refuses filing and composing, and the picker omits converted leads.

## Lead Communication tab

`/intake/[id]/communication`:
- Email list uses new `listThreadsForLead(leadId, page)`, mirroring
  `listThreadsForMatter` (filed to the lead, viewer's own mailbox, paged).
  `?thread=` is validated against that list.
- Contact-address matching (`listThreadsForEmail`) is removed from the
  tab; delete the query if nothing else uses it. The feature doc records
  the deferral to the categorizer.
- Empty state: "No emails filed to this lead yet", with Compose.

## Permissions

No new keys. Sending: `communication.send_email`. Filing (including the
file-on-reply step): `communication.file_email`.

## Testing

- Filing action: file to matter / lead, both scope checks, converted lead
  refused, unfile refused with app-sent mail and allowed when all inbound,
  move logs on both records, other mailbox → "Thread not found".
- `sendEmail` / `replyToThread`: missing or invalid scope refused before
  Gmail is called (Gmail fetch mocked); successful send files the thread
  and sets `sentFromApp`; reply on unfiled thread files first; file
  succeeds + send fails leaves it filed; no `file_email` refused; existing
  thread filed elsewhere keeps its filing and returns the notice.
- Conversion: lead threads (including another user's) move to the matter;
  count appears in the timeline entry.
- Queries: `listThreadsForLead` returns only the viewer's own threads; a
  `?thread=` filed elsewhere is not selectable.
- Components: compose Send disabled without a record; picker groups
  matters and leads; prefilled record on matter/lead tabs; reply picker
  only on unfiled threads; Unfile hidden with app-sent mail.
- Migration: `npm run check:migrations`; generate via `migrate diff` on a
  local Docker scratch DB (`.env` points at remote dev).

## Docs to update on ship

- `docs/features/communication-email.md`: filing to leads, sent-mail rule,
  categorizer deferral; ROADMAP line.
- `docs/features/intake.md`: conversion carries email threads; lead tab.
- New ADR: "Every app-sent email is filed to a matter or lead" (why unfile
  is refused, why contact matching is deferred).
- `docs/SCHEMA_NOTES.md`: the at-most-one invariant and `sentFromApp`
  ownership.
