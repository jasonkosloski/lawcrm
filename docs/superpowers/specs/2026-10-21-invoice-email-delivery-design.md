# Invoice email delivery: design

Tier: Full (money: invoices). Closes [issues/invoice-email-not-sent.md](../../issues/invoice-email-not-sent.md).

## Goal

The "Email" send method, the "Send updated invoice" checkbox on Record
payment, and a new "Re-send email" action actually email the client the
invoice as a PDF attachment through Resend. When the client portal is
live for the matter, the email also links to the invoice in the portal.
A copy of every PDF we attempt to send is filed to the matter.

Out of scope: US mail (stays disabled), CC, editable subject/message,
bounce/delivery webhooks, a delivery-status column, automatic retries.

## Decisions

- **PDF engine:** `@react-pdf/renderer` in plain Node. Rejected: headless
  Chromium rendering `/print/invoices/[id]` (≈60 MB binary, cold starts, an
  auth bypass into the print page) and hosted PDF APIs (client data to a
  third party).
- **Order:** the existing send/payment transaction commits first; delivery
  runs after. The PDF must show post-commit state (re-dated issue/due dates,
  trust applied), and a network call must not hold invoice/matter row locks.
  A failed email never rolls back the send (money may have moved).
- **From / Reply-To:** From is `"<Firm.shortName ?? Firm.name>" <address of EMAIL_FROM>`
  on the already-verified Resend domain; Reply-To is the sending staff
  member's email.
- **No schema change.** The "Invoices" folder uses the existing string
  `DocumentFolder.systemKind`; delivery history lives in the activity log.
- **No new permission key.** Emailing (or re-emailing) an invoice is part
  of `billing.send_invoice`.

## Components

### 1. Email transport (`src/lib/email/drivers.ts`, `send.ts`)

- `OutgoingEmail` gains optional `replyTo?: string`,
  `fromName?: string`, and
  `attachments?: { filename: string; content: Buffer; contentType?: string }[]`.
- `EmailResult` success becomes `{ ok: true; id?: string }`.
- `resendDriver` sends `reply_to`, base64 `attachments`, and a display
  name on `from` when `fromName` is set (address taken from `EMAIL_FROM`,
  which may already be `Name <addr>` form; we use only the address part).
  Returns Resend's `id`.
- `consoleDriver` logs attachment filenames and sizes, not bytes.
  `notConfiguredDriver` unchanged (fails).
- Existing callers are unaffected (all new fields optional).

### 2. Email content (`src/lib/billing/invoice-email.ts`)

`invoiceEmail({ kind, invoiceNumber, firmName, matterName, balanceDue, dueDate, portalUrl })`
→ `{ subject, text, html }`. All dynamic values HTML-escaped.

- Subject: `Invoice <n> from <firm>`; `kind: "updated"` →
  `Updated invoice <n> from <firm>`. `"resend"` uses the initial subject.
- Body: short cover note: invoice number, matter name, amount due and due
  date (date-only, formatted as a UTC calendar date per ADR-012), "The
  invoice is attached as a PDF." Balance ≤ 0 → "This invoice is paid in
  full. Thank you." instead of amount/due.
- Portal paragraph only when `portalUrl` is set: "You can also view this
  invoice in your client portal: <link>".
- Portal URL: `${portalHomeUrl()}/matters/<matterId>/invoices/<invoiceId>`
  (proxy rewrites to `/portal/...`), included only when
  `resolvePortalSendTarget(invoiceId).available`. No sign-in token in the
  email; an unauthenticated visitor gets the portal's normal sign-in.

### 3. PDF (`src/lib/billing/invoice-pdf.tsx`)

`renderInvoicePdf(invoice: InvoiceDetail, firm): Promise<Buffer>`.

- Mirrors `InvoicePreview` sections: letterhead, bill-to, invoice number /
  issue / due dates, time and expense lines, subtotal / tax / total,
  payments received, balance due.
- Renders stored money values verbatim; never re-derives totals.
- Date-only fields formatted in UTC (ADR-012).
- Built-in Helvetica (no runtime font fetch).
- Add `@react-pdf/renderer` to `serverExternalPackages` if the bundled
  Next docs (`node_modules/next/dist/docs/`) call for it.
- Filename: `Invoice <n>.pdf`.

### 4. Filing (`src/lib/billing/invoice-filing.ts`)

`fileInvoicePdf({ matterId, invoiceNumber, kind, bytes, userId, dateLabel })`.

- Lazily get-or-create the matter's system folder `systemKind: "invoices"`,
  name "Invoices", `clientShared: false`, with the same create-once
  handling as the `portal_uploads` "From client" folder
  (`src/lib/portal/record-upload.ts`). Add `"invoices"` to
  `FOLDER_SYSTEM_KINDS` in `src/lib/records-requests/folder-kinds.ts`
  (any non-null `systemKind` is already protected from
  rename/move/delete).
- `storeFile` then `document.create`: `category: "correspondence"`,
  `source: "invoice"`, `contentType: "application/pdf"`, name
  `Invoice <n> (sent YYYY-MM-DD).pdf` or `(updated YYYY-MM-DD)` /
  `(resent YYYY-MM-DD)`, date = the sender's calendar day
  (`todayDateOnly`). If the row write fails, delete the stored file.
- Server-to-storage only; bytes never cross a server action boundary
  (ADR-034).

### 5. Delivery orchestrator (`src/lib/billing/invoice-delivery.ts`)

`deliverInvoiceEmail({ invoiceId, to, userId, kind: "initial" | "updated" | "resend" })`
→ `{ ok: true } | { ok: false; warning: string }`. Never throws.

1. Load `getInvoiceById`, firm, sender email.
2. Render PDF. Failure → log "email failed", return warning (nothing sent).
3. File PDF (step 4). Failure → remember it, continue.
4. Resolve portal URL; build email; `sendEmail` with attachment, `fromName`,
   `replyTo`.
5. `logActivity` type `filing`, one row per attempt:
   - ok: `Invoice <n> emailed to <to>` / `Updated invoice <n> emailed to <to>`,
     detail `Resend id <id>`.
   - fail: `Invoice <n> email failed: <to>`, detail = reason.
6. Warning text combines email failure ("…the email didn't go out: <reason>.
   Use Re-send email to retry.") and/or filing failure ("…couldn't save a
   copy to Documents.").
7. `revalidatePath` the matter documents tab when filed.

### 6. Actions (`src/app/actions/billing/payments.ts`)

- `BillingFormState` gains `warning?: string`.
- `sendInvoice`, method `email`: transaction unchanged; after commit, call
  `deliverInvoiceEmail(kind "initial")` instead of logging
  "(not emailed)". Return `status: "ok"` with `warning` when delivery
  failed. `mail` stays refused. `portal` unchanged.
- `recordInvoicePayment` with `notifyClient` and a client email on file:
  after commit, `deliverInvoiceEmail(kind "updated")`; replaces the
  "(not emailed)" row. No email on file → skip silently (unchanged).
- New `resendInvoiceEmail(invoiceId, _prev, formData)`:
  `requirePermission("billing.send_invoice")`,
  `assertChildMatterAccess("invoice", invoiceId)`, recipient validated
  like `sendInvoice`, invoice must be `kind: "client"` with status
  `sent | partial | paid`. No status or money change. Calls
  `deliverInvoiceEmail(kind "resend")`; email failure here returns
  `status: "error"` (nothing else happened, so it is a plain failure).

### 7. UI

- `send-invoice-dialog.tsx`: title "Send invoice <n>"; description: email
  sends the PDF from the firm via Resend, replies go to you; client portal
  posts it and emails a notice; mail is coming soon. Remove the
  "nothing is emailed" copy and the header comment saying so. On
  `ok` + `warning`, show a warning toast (survives dialog close).
- `invoice-action-bar.tsx`: update the send tooltip; add "Re-send email"
  for client invoices in `sent | partial | paid` when the viewer holds
  `billing.send_invoice`.
- New `resend-invoice-dialog.tsx`: recipient field pre-filled from client
  email, Send button, error banner on failure, success toast.
- Record payment dialog: drop "Logged-only for now"; hint reads "Emails
  the refreshed PDF to the client's email on file"; warning toast on
  `warning`.

### 8. Docs (same commits as the code that makes them stale)

- Delete `docs/issues/invoice-email-not-sent.md` and its row in
  `docs/issues/README.md`.
- ROADMAP: mark **Invoice email delivery** `[x]`; drop the caveat in
  "Where we are".
- `docs/features/time-and-billing.md`: describe delivery end state;
  `docs/features/documents.md` if it lists system folder kinds.
- Delete this spec and its plan when the feature ships.

## Error handling summary

| Failure | Invoice/money | Email | Filed copy | User sees |
|---|---|---|---|---|
| Transaction fails | rolled back | not attempted | none | error (unchanged) |
| PDF render fails | committed | not sent | none | ok + warning |
| Filing fails | committed | sent | none | ok + warning |
| Resend fails / not configured | committed | not sent | filed | ok + warning |
| Re-send: send fails | n/a | not sent | filed | error |

## Testing

Unit:
- `drivers.test.ts`: Resend body includes `reply_to`, base64
  `attachments`, display-name `from`; returns `id`; existing payloads
  unchanged when new fields absent.
- `invoice-email.test.ts`: subjects per kind; paid-in-full copy; portal
  paragraph only with `portalUrl`; HTML escaping.
- `invoice-pdf.test.ts`: output starts with `%PDF`; text extracted with
  `pdfjs-dist` contains invoice number, every line amount, total,
  payments, balance from the fixture `InvoiceDetail`.

Integration (Docker test DB, `captureEmails()`):
- `sendInvoice` email: status sent; one email, right recipient, attachment,
  Reply-To; PDF filed in the "Invoices" system folder; "emailed" activity.
- With trust applied: PDF text shows the payment and remaining balance.
- Driver returns not-ok: invoice still sent, trust still applied,
  `ok` + `warning`, "email failed" row, PDF still filed.
- Filing failure: email still sent, warning returned.
- `recordInvoicePayment` + notifyClient: "updated" email sent; no client
  email → nothing sent, payment intact.
- `resendInvoiceEmail`: denied without `billing.send_invoice`; denied
  across an ethical wall; refused on draft/approved; no status change;
  one email.
- Portal link present when available; absent when matter
  `portalBillingEnabled` is off.
- "Invoices" folder created once across repeated sends.

Component: send dialog copy + warning toast; re-send dialog pre-fill and
submit.

Manual: run locally, send via Resend to a real inbox, open the PDF and
check layout.
