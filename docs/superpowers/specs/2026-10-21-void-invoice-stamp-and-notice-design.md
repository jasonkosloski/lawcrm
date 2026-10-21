# Void invoice: VOID stamp and client notice: design

Tier: Full (money: invoices; schema change). Builds on invoice email
delivery (see `docs/features/time-and-billing.md`).

## Goal

When a client invoice is voided, every PDF of it filed in the matter's
"Invoices" folder is stamped VOID in place, and if the invoice was sent the
client gets an email with the stamped PDF attached.

Out of scope: voided invoices in the client portal (they stay hidden),
re-sending a void notice, stamping anything other than invoice PDFs filed by
the app, internal-record invoices.

## Facts this design rests on

- Void is allowed only from `approved` or `sent` client invoices with no
  payments (`canVoidInvoice`), and from internal-record drafts.
- The void transaction unlinks time entries and expenses, so a PDF rendered
  after the commit has no line items.
- Filed invoice PDFs (`src/lib/billing/invoice-filing.ts`) live in the
  matter's `systemKind: "invoices"` folder; today nothing links a Document to
  its Invoice except the name `Invoice <n> (<label> YYYY-MM-DD).pdf`.

## Decisions

- **Stamp in place.** The filed PDF's bytes are replaced by a stamped copy;
  the unstamped bytes are not kept. The activity log records the stamping.
- **Link by column.** New nullable `Document.invoiceId`.
- **Email** only for invoices that were `sent`, opt-out checkbox (default on),
  stamped PDF attached; needs `billing.send_invoice` in addition to
  `billing.void_invoice`.
- **Stamp library:** `pdf-lib` (MIT), pinned exact. `@react-pdf/renderer`
  can't edit existing PDFs.
- **Order:** any needed fresh render happens before the void transaction;
  stamping, filing and email happen after it commits. Failures after commit
  never undo the void; they return `ok` + `warning`.

## Components

### 1. Schema (`prisma/schema.prisma`, migration)

- `Document.invoiceId String?`, relation to `Invoice` with
  `onDelete: SetNull`, `@@index([invoiceId])`; back-relation
  `Invoice.documents Document[]`.
- Migration is expand-only (ADR-058). It also backfills (idempotent):
  ```sql
  UPDATE documents d SET invoice_id = i.id
  FROM document_folders f, invoices i
  WHERE d.folder_id = f.id AND f.system_kind = 'invoices'
    AND i.matter_id = d.matter_id AND d.invoice_id IS NULL
    AND d.name LIKE 'Invoice ' || i.invoice_number || ' (%';
  ```
  (Column/table names to match the schema's `@map`s.)
- Create via `prisma migrate diff` against a local Docker scratch DB (the
  `.env` direct URL points at remote dev); then `npm run check:migrations`.
- `fileInvoicePdf` gains `invoiceId` in its input and writes it.

### 2. Stamp (`src/lib/billing/void-stamp.ts`)

`stampVoid(bytes: Buffer, voidedOn: string /* display text */): Promise<Buffer>`

- `PDFDocument.load`, then on every page draw "VOID" in Helvetica-Bold,
  red (`rgb(0.8, 0.1, 0.1)`), opacity 0.35, size ~ page width / 4, rotated
  45° about the page centre; and "Voided <voidedOn>" in 10 pt at the top
  right margin. Save and return a Buffer.
- Only overlays; original text stays extractable.

### 3. Replace filed copies (`src/lib/billing/void-filing.ts`)

`stampFiledInvoicePdfs({ invoiceId, voidedOn, userId }): Promise<{ stamped: number; latest: { name: string; bytes: Buffer } | null; failed: number }>`

- Finds `document` rows with this `invoiceId` (matter scope comes from the
  invoice; caller already asserted access).
- For each: `readStoredFile` → `stampVoid` → `storeFile` (new key, same
  name, `application/pdf`) → conditional `document.updateMany({ where: { id,
  fileUrl: oldKey }, data: { fileUrl: newKey, fileSize } })`; count 0 → delete
  the new key (lost a race). Then `deleteFile(oldKey)` best-effort.
- Per-document failure is counted, not thrown; that document keeps its
  original key. Never throws.
- `latest` = the most recently created stamped document (for the email).

`fileVoidedInvoicePdf({ matterId, invoiceId, invoiceNumber, bytes, userId, day })`
— reuse `fileInvoicePdf` with a new label `void` → name
`Invoice <n> (void YYYY-MM-DD).pdf`.

### 4. Void email (`src/lib/billing/invoice-email.ts`)

`invoiceVoidEmail({ invoiceNumber, firmName, matterName })` → `{ subject, text, html }`:

- Subject: `Invoice <n> from <firm> has been voided`
- Body: `Invoice <n> for <matter> has been voided and no payment is due on it. A copy marked VOID is attached for your records.`
- Escaped like the other builders. No portal link.

### 5. Action (`src/app/actions/billing/lifecycle.ts`)

New `voidInvoice(invoiceId: string, _prev: BillingFormState, formData: FormData): Promise<BillingFormState>`;
form fields `notifyClient` ("true" | "") and `recipient`.

1. `requirePermission("billing.void_invoice")`, `assertChildMatterAccess("invoice", invoiceId)`, `getCurrentUserId()` (outside try).
2. Validate: when `notifyClient`, `recipient` must match `RECIPIENT_EMAIL_RE`
   (export it from where it lives in `payments.ts`, or move to
   `src/lib/billing-form.ts`); field error otherwise. `notifyClient` is
   ignored unless `currentUserHasPermission("billing.send_invoice")`.
3. Read invoice (`kind`, `status`, `paidAmount`, `matterId`, `invoiceNumber`).
   Client + `sent` + zero filed documents → render the PDF now with
   `renderInvoicePdf` (sender zone), stamp it, hold the bytes. A render
   failure here is not fatal: proceed without a fresh copy (warning later).
4. Run the existing void path (`setInvoiceStatusUnchecked(invoiceId, "void", userId)`)
   — same checks, conditional write, unlinking, activity row, revalidation.
   `{ ok: false }` → return `status: "error"` with its message; nothing
   else happens.
5. After commit, only for client invoices that were `sent`:
   - stamp filed copies (§3), or file the pre-rendered stamped copy;
     activity `Stamped <k> filed PDF(s) of invoice <n> VOID` (or
     `Filed voided copy of invoice <n>`); failures → warning
     `Some filed copies couldn't be stamped VOID.`
   - if notify allowed and requested and a stamped PDF exists: `sendEmail`
     with `fromName`, `replyTo` (sender), attachment
     `Invoice <n> (VOID).pdf`, idempotency key
     `invoice-void-${invoiceId}-${uuid}`; activity
     `Void notice for invoice <n> emailed to <to>` / `Void notice for invoice <n> email failed: <to>`
     (reason as detail). Failure → warning
     `The void notice didn't go out: <reason>.`
   - No stamped PDF available but email requested → no email; warn
     `No PDF was available, so the client wasn't emailed.`
   - Whole post-commit block in its own try/catch → never turns the
     committed void into an error.
6. Return `{ status: "ok", warning? }` (warning prefixed `Invoice voided. `).

The existing `setInvoiceStatus(id, "void")` stays for approved-only client
invoices and internal records.

Shared helpers: firm via `loadFirmProfileForUser`, sender email lookup,
`todayDateOnly` and `formatDate(…, "long", tz)` as in `invoice-delivery.ts`;
extract a small shared helper only if it removes real duplication.

### 6. UI

- New `src/components/matters/billing/void-invoice-dialog.tsx`
  (structure copies `resend-invoice-dialog.tsx`): title `Void invoice <n>`;
  description `Voiding returns its time and expenses to unbilled. Filed copies are stamped VOID.`;
  when `canSendInvoice`: checkbox `Email the client a voided copy` (default
  checked) and `Recipient` (pre-filled `clientEmail`, required while
  checked); destructive button `Void invoice`; pending `Voiding…`;
  `notifyWarning` on `ok` + `warning`, `notifySuccess("Invoice voided.")`
  otherwise. Kept mounted like the other dialogs.
- `invoice-action-bar.tsx`: the Void menu item opens this dialog when
  `kind === "client" && currentStatus === "sent"`; otherwise the current
  confirm + `setInvoiceStatus` path is unchanged.

### 7. Docs

`docs/features/time-and-billing.md` (void behaviour), `docs/SCHEMA_NOTES.md`
(`Document.invoiceId`, backfill-by-name), ROADMAP line, delete this spec and
its plan when shipped.

## Error handling

| Failure | Void | Filed copies | Email | User sees |
|---|---|---|---|---|
| Permission / wall / payment / race | not done | untouched | none | error |
| Pre-void render fails (no filed copy) | done | none filed | skipped | ok + warning |
| A copy fails to stamp | done | that copy unstamped | sent with another stamped copy if any | ok + warning |
| Email fails / not configured | done | stamped | not sent | ok + warning |
| No send permission / unticked | done | stamped | none | ok |
| Approved (never sent) | done | none | none | ok |

## Testing

Unit: `stampVoid` (valid `%PDF`, page count unchanged, text has original
invoice number and "VOID"); `invoiceVoidEmail` (subject, body, escaping).

Integration (`captureEmails`, mocked storage with real bytes in a Map):
- sent + two filed copies → both rows get new keys + stamped bytes, names
  unchanged, old keys deleted, email with stamped attachment, activity rows,
  entries unlinked;
- sent + none filed → one `(void …)` doc with `invoiceId`, PDF text lists the
  line items, attached;
- approved → nothing filed, no email; unticked → stamped, no email; no
  `billing.send_invoice` → stamped, no email;
- failing driver → void stands, warning; stamp failure on one copy → that
  row keeps its key, warning;
- refused without `billing.void_invoice`, across a wall (nothing rendered),
  with a payment recorded; payment racing in between → error, nothing
  stamped;
- `fileInvoicePdf` writes `invoiceId`; migration backfill links by name.

Component: dialog shows checkbox + recipient only for sent + `canSendInvoice`,
default checked, submits, warning toast; approved invoices keep the confirm.
