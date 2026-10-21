# Invoice Email Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email invoices to clients as a PDF attachment via Resend (on send, after a payment, and on demand), with a portal link when the portal is live, filing each PDF to the matter.

**Architecture:** The existing send/payment transactions are unchanged and commit first. A never-throwing orchestrator (`deliverInvoiceEmail`) then loads the invoice, renders a PDF with `@react-pdf/renderer`, files it into a protected "Invoices" system folder, sends through the existing `sendEmail` (extended with attachments / reply-to / from-name), and logs one activity row. Email failure returns `ok` + `warning`, never rolls back.

**Tech Stack:** Next.js server actions, Prisma, Vitest (Docker test DB on :5433), `@react-pdf/renderer`, Resend REST API via `fetch`, `pdfjs-dist` (tests only).

**Spec:** `docs/superpowers/specs/2026-10-21-invoice-email-delivery-design.md`

## Global Constraints

- Every test run needs `docker compose -f docker-compose.test.yml up -d` first.
- No schema change, no migration. No new permission key (`billing.send_invoice` covers send and re-send).
- Delivery runs only after the transaction commits; never call Resend or render inside `prisma.$transaction`.
- `deliverInvoiceEmail` never throws; failures become `warning` strings.
- From: `"<Firm.shortName ?? Firm.name>" <address of EMAIL_FROM>`; Reply-To: sending user's email.
- Invoice issue/due dates are instants: `formatDate(d, "long", tz)` in the sender's zone (`getCurrentUserTimeZone()`), like `InvoicePreview`. Date-only values (payment dates, filing name date) via `formatDateOnly` / `todayDateOnly` (ADR-012).
- Money rendered from stored values, never recomputed.
- All dynamic HTML escaped with `escapeHtml` (`src/lib/email/escape.ts`).
- Bytes only server → storage (`storeFile`), never through a server action (ADR-034).
- `@react-pdf/renderer` is on Next's default `serverExternalPackages` list; no `next.config.ts` change.
- Commit with explicit pathspec: `git add -- <new files> && git commit -m "…" -- <paths>`; never leave files staged. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Client with no email / blank recipient on re-send**: refused with a field error, nothing filed or sent (Task 6 test).
2. **`RESEND_API_KEY` unset in production**: `notConfiguredDriver` fails → invoice still sent, warning says email didn't go out (Task 5 test with failing driver covers the path).
3. **Hostile names** (`<script>` in matter/firm/client name): escaped in email HTML; PDF renders text literally (Task 2 escaping test; Task 3 fixture uses `&`/`<` in names).
4. **Repeated sends on the same matter**: one "Invoices" folder, multiple Documents with distinct names (Task 4 test).
5. **Ethical wall on re-send**: user without matter access gets refused before any render (Task 6 test).

---

### Task 1: Email transport supports attachments, reply-to, from-name, message id

**Files:**
- Modify: `src/lib/email/drivers.ts`, `src/test/email-capture.ts`
- Test: `src/lib/email/drivers.test.ts` (create; `send.test.ts` exists—leave it)

**Interfaces:**
- Produces:
  ```ts
  type EmailAttachment = { filename: string; content: Buffer; contentType?: string };
  type OutgoingEmail = { to: string; subject: string; text: string; html: string;
    replyTo?: string; fromName?: string; attachments?: EmailAttachment[] };
  type EmailResult = { ok: true; id?: string } | { ok: false; error: string };
  ```
  `captureEmails()` unchanged signature; its driver returns `{ ok: true, id: "test-<n>" }`. Add `captureEmails({ fail: "reason" })` option → driver records the message and returns `{ ok: false, error: reason }`.

- [ ] **Step 1: Write failing tests** in `drivers.test.ts` with `vi.stubGlobal("fetch", …)` and `EMAIL_FROM="Litgox <noreply@litgox.com>"`:
  - `resend driver sends reply_to, base64 attachments and display-name from`: body has `reply_to: "a@firm.com"`, `attachments: [{ filename: "Invoice 1.pdf", content: Buffer.from("%PDF").toString("base64") }]`, `from: '"Kosloski Law" <noreply@litgox.com>'`; result `{ ok: true, id: "re_123" }` when fetch returns `{ id: "re_123" }`.
  - `resend driver payload is unchanged when new fields are absent`: body keys exactly `from,to,subject,text,html`, `from === "Litgox <noreply@litgox.com>"`.
  - `fromName with quotes is escaped`: `fromName: 'A "B" C'` → from `'"A \\"B\\" C" <noreply@litgox.com>'`.
  - `console driver logs attachment names and sizes, not bytes`.
- [ ] **Step 2:** `npx vitest run src/lib/email/drivers.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Extract the address from `EMAIL_FROM` (`/<([^>]+)>/` else the trimmed value). Include optional keys only when set. Parse `id` from the JSON response (missing → undefined). Update `captureEmails`.
- [ ] **Step 4:** Run `drivers.test.ts` and `send.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(email): attachments, reply-to and from-name on Resend sends`.

### Task 2: Invoice email content

**Files:**
- Create: `src/lib/billing/invoice-email.ts`, `src/lib/billing/invoice-email.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type InvoiceEmailKind = "initial" | "updated" | "resend";
  function invoiceEmail(input: { kind: InvoiceEmailKind; invoiceNumber: string; firmName: string;
    matterName: string; balanceDue: number; dueDate: Date; timeZone: string; portalUrl: string | null }):
    { subject: string; text: string; html: string };
  function portalInvoiceUrl(matterId: string, invoiceId: string): string; // `${portalHomeUrl()}/matters/${matterId}/invoices/${invoiceId}`
  ```

- [ ] **Step 1: Failing tests:**
  - subjects: initial/resend → `"Invoice 2026-101 from Kosloski Law"`; updated → `"Updated invoice 2026-101 from Kosloski Law"`.
  - balance 1234.5 → text contains `"$1,234.50"` and `formatDate(dueDate,"long","America/Denver")`; contains `"The invoice is attached as a PDF."`.
  - balance 0 → contains `"This invoice is paid in full. Thank you."`, no `"$0.00"`.
  - portalUrl set → text and html contain the URL and `"view this invoice in your client portal"`; null → neither.
  - matterName `"<b>A&B</b>"` → html contains `"&lt;b&gt;A&amp;B&lt;/b&gt;"`, not `"<b>"`.
  - `portalInvoiceUrl("m1","i1")` with `PORTAL_HOST=portal.litgox.com` → `"https://portal.litgox.com/matters/m1/invoices/i1"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (pure; money formatted `en-US` 2dp).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(billing): invoice email content`.

### Task 3: Invoice PDF renderer

**Files:**
- Modify: `package.json` / lockfile (`npm install @react-pdf/renderer` — pin exact version, `--save-exact`)
- Create: `src/lib/billing/invoice-pdf.tsx`, `src/lib/billing/invoice-pdf.test.ts`

**Interfaces:**
- Consumes: `InvoiceDetail` (`src/lib/queries/billing.ts`).
- Produces:
  ```ts
  type InvoicePdfFirm = { name: string; shortName: string | null; address/phone/email fields as InvoicePreview reads them };
  function renderInvoicePdf(invoice: InvoiceDetail, firm: InvoicePdfFirm, timeZone: string): Promise<Buffer>;
  function invoicePdfFilename(invoiceNumber: string): string; // "Invoice 2026-101.pdf"
  ```
  Read `src/components/matters/billing/invoice-preview.tsx` for section order, field names and labels; mirror them. `import "server-only"`.

- [ ] **Step 1: Failing test** with a hand-built `InvoiceDetail` fixture (2 time lines, 1 expense line, 1 payment, tax, client name `"O'Neil & <Sons>"`): output starts with `%PDF`; text extracted via `pdfjs-dist` (`getDocument({ data }).promise` → `getTextContent` per page, joined) contains the invoice number, each line amount, subtotal, total, payment amount, balance due (all formatted `$x,xxx.xx`), and `"O'Neil & <Sons>"`. Test `invoicePdfFilename`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** with `@react-pdf/renderer` (`Document/Page/View/Text/StyleSheet`, `renderToBuffer`), Helvetica, Letter size.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(billing): server-side invoice PDF` (include package.json + lockfile).

### Task 4: File the PDF into the matter's "Invoices" system folder

**Files:**
- Modify: `src/lib/records-requests/folder-kinds.ts` (add `"invoices"` to `FOLDER_SYSTEM_KINDS`)
- Create: `src/lib/billing/invoice-filing.ts`, `src/lib/billing/invoice-filing.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function fileInvoicePdf(input: { matterId: string; invoiceNumber: string; kind: InvoiceEmailKind;
    bytes: Buffer; userId: string; day: Date /* date-only */ }): Promise<{ documentId: string }>; // throws on failure
  ```
  Name: `Invoice <n> (sent|updated|resent YYYY-MM-DD).pdf` (`initial`→sent, `resend`→resent); `dateOnlyKey(day)`. Document: `category: "correspondence"`, `source: "invoice"`, `contentType: "application/pdf"`, `folderId` = Invoices folder, `uploadedBy: userId`. Folder: `{ matterId, name: "Invoices", systemKind: "invoices", clientShared: false }`, get-or-create copying the create-once handling in `src/lib/portal/record-upload.ts` (~line 140). Row write fails → `deleteFile(stored.key)` then rethrow.

- [ ] **Step 1: Failing integration tests** (seed matter as in `billing.portal-send.test.ts`; mock `@/lib/file-storage` `storeFile`/`deleteFile` as in `document-copies-attachments.test.ts`):
  - first call creates exactly one folder with `systemKind: "invoices"`, `clientShared: false`, and a Document named `"Invoice 2026-101 (sent 2026-10-21).pdf"`.
  - second call (kind `"updated"`) reuses the folder (`count === 1`), Document `"… (updated 2026-10-21).pdf"`.
  - `document.create` failure (spy rejects) → `deleteFile` called with the stored key, call rejects.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; also run `src/lib/records-requests` tests (kind list change).
- [ ] **Step 5: Commit** `feat(billing): file sent invoice PDFs to the matter`.

### Task 5: Delivery orchestrator

**Files:**
- Create: `src/lib/billing/invoice-delivery.ts`, `src/lib/billing/invoice-delivery.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `getInvoiceById`, `resolvePortalSendTarget`, `getCurrentUserTimeZone`, `todayDateOnly` (`src/app/actions/billing/helpers.ts` — move to `src/lib/billing/` only if importing from actions breaks `"use server"` rules; it is a plain export, so import directly), `logActivity`, `revalidatePath`.
- Produces:
  ```ts
  type DeliveryResult = { ok: true } | { ok: false; warning: string; emailSent: boolean };
  function deliverInvoiceEmail(input: { invoiceId: string; to: string; userId: string;
    kind: InvoiceEmailKind }): Promise<DeliveryResult>; // never throws
  ```
  Steps per spec §5. Firm via `prisma.firm.findFirst`; sender email via `prisma.user.findUnique({ where: { id: userId }, select: { email: true } })`. Activity rows (`type: "filing"`, `matterId`, `userId`):
  - sent: title `Invoice <n> emailed to <to>` (kind updated: `Updated invoice <n> emailed to <to>`), detail `Resend id <id>` or null.
  - failed: title `Invoice <n> email failed: <to>`, detail = error.
  Warnings: email fail → `` `The email didn't go out: ${reason}. Use Re-send email to retry.` ``; filing fail (email ok) → `"The invoice was emailed, but a copy couldn't be saved to Documents."`; both joined with a space. `emailSent` lets Task 6 tell the cases apart. `revalidatePath(`/matters/${matterId}/documents`)` when filed.

- [ ] **Step 1: Failing integration tests** (`captureEmails`, seeded firm `name: "Kosloski Law"`, user email `atty@firm.com`, approved→sent invoice with one line; storage mocked):
  - success: one email to `client@x.com`, `fromName: "Kosloski Law"`, `replyTo: "atty@firm.com"`, one attachment `"Invoice <n>.pdf"` starting `%PDF`; Document filed; activity title `"Invoice <n> emailed to client@x.com"`; returns `{ ok: true }`.
  - portal available (identity + access + `portalBillingEnabled`) → email text contains `/matters/<matterId>/invoices/<invoiceId>`; `portalBillingEnabled: false` → absent.
  - `captureEmails({ fail: "Resend responded 500" })` → `{ ok: false, emailSent: false }`, warning contains `"Resend responded 500"`, activity `"Invoice <n> email failed: client@x.com"`, Document still filed.
  - `storeFile` rejects → email still captured, `{ ok: false, emailSent: true }`, warning mentions Documents.
  - `getInvoiceById` missing invoice id → returns warning, no throw, no email.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(billing): invoice email delivery orchestrator`.

### Task 6: Wire actions — send, updated-after-payment, re-send

**Files:**
- Modify: `src/lib/billing-form.ts` (`BillingFormState.warning?: string`), `src/app/actions/billing/payments.ts`, `src/app/actions/billing/index.ts` (export `resendInvoiceEmail`)
- Modify tests: `src/app/actions/billing.flows.test.ts` (~lines 384–402), `src/app/actions/billing.portal-send.test.ts` (~line 232) — replace "(not emailed)" expectations
- Create: `src/app/actions/billing.email-send.test.ts`

**Interfaces:**
- Consumes: `deliverInvoiceEmail` (Task 5).
- Produces: `resendInvoiceEmail(invoiceId: string, _prev: BillingFormState, formData: FormData /* recipient */): Promise<BillingFormState>`.

- [ ] **Step 1: Failing tests** in `billing.email-send.test.ts` (setup copied from `billing.portal-send.test.ts`, method `email`):
  - `sendInvoice` email: status `sent`, one captured email with attachment, result `{ status: "ok" }` without `warning`; no activity title contains `"not emailed"`.
  - with `applyTrust` (matter trust seeded): invoice `paid`/`partial` as today; extracted PDF text contains the trust payment amount.
  - failing driver: invoice status `sent`, trust still applied, result `status: "ok"` with `warning` containing `"Re-send email"`.
  - `recordInvoicePayment` with `notifyClient=true` and client email → one email, subject starts `"Updated invoice"`; client without email → zero emails, payment recorded.
  - `resendInvoiceEmail`: on `sent` invoice → one email, status unchanged, `{ status: "ok" }`; on `approved` → `status: "error"`, zero emails; recipient `"nope"` → `errors.recipient`; `requirePermission` mock rejects → rejects (assert called with `"billing.send_invoice"`); `assertChildMatterAccess` throwing (mock `@/lib/matter-access` to throw `notFound`) → rejects, zero emails; failing driver → `status: "error"` with the warning text as `error`.
  - Update the two old tests to expect `"Invoice <n> emailed to <recipient>"`.
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3: Implement.**
  - `sendInvoice`: replace the non-portal `logActivity` branch with `deliverInvoiceEmail({ kind: "initial", to: result.recipient, … })`; on `ok: false` return `{ ...billingInitialState, status: "ok", warning: `Invoice ${n} was marked sent. ${warning}` }`. Delivery runs before `revalidatePath`. Update the comments that say nothing is emailed.
  - `recordInvoicePayment`: replace the "(not emailed)" block with `deliverInvoiceEmail({ kind: "updated", to: clientEmail })`; warning prefix `` `Payment recorded. ` ``. Update the `notifyClient` schema doc comment.
  - `resendInvoiceEmail`: gates first (`requirePermission`, `assertChildMatterAccess`, `getCurrentUserId`), recipient regex as `sendInvoice`, load `{ kind, status }`; refuse unless `kind === "client"` and status in `sent|partial|paid` with `"Only sent invoices can be re-sent."`; deliver `kind: "resend"`; `!ok && !emailSent` → `{ status: "error", error: warning }`; `!ok && emailSent` → ok + warning; `revalidatePath` matter billing.
- [ ] **Step 4:** Run the three files plus `billing.test.ts`, `billing.concurrency.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(billing): email invoices on send, after payment, and on re-send`.

### Task 7: UI — send dialog, record-payment copy, re-send dialog

**Files:**
- Modify: `src/lib/feedback.ts` (add `notifyWarning(message: string): void`, sonner `toast.warning`, same shape as `notifyError`)
- Modify: `src/components/matters/billing/send-invoice-dialog.tsx` (+ `.test.tsx`), `record-payment-dialog.tsx` (+ test), `invoice-action-bar.tsx` (+ test)
- Create: `src/components/matters/billing/resend-invoice-dialog.tsx`, `resend-invoice-dialog.test.tsx`

**Interfaces:**
- Consumes: `resendInvoiceEmail`, `BillingFormState.warning`.
- Produces: `ResendInvoiceDialog({ open, onOpenChange, invoiceId, invoiceNumber, clientEmail })`.

Copy (exact):
- Send dialog title: `Send invoice {invoiceNumber}`. Description: `Email sends the invoice as a PDF from the firm; replies come to you. Client portal posts it for the client to view and emails them a notice. US mail is coming soon.` Header comment rewritten to match.
- Action bar send-button tooltip: `Email the invoice to the client, or post it to the client portal.` Kebab item (sent/partial/paid, `canSendInvoice`, client kind): `Re-send email…`.
- Re-send dialog title `Re-send invoice {invoiceNumber}`, description `Emails the current invoice as a PDF. Nothing else changes.`, field label `Recipient`, button `Send`.
- Record payment checkbox hint: `Emails the refreshed invoice PDF to {clientEmail}.` (remove "Logged-only for now").
- On `state.status === "ok" && state.warning` → `notifyWarning(state.warning)` in all three dialogs; success on re-send → `notifySuccess("Invoice emailed.")`.

- [ ] **Step 1: Failing component tests:** send dialog shows new title/description and no `"nothing is emailed"`; with mocked action returning `{ status: "ok", warning: "W" }` calls `notifyWarning("W")` (mock `@/lib/feedback`). Re-send dialog pre-fills `client@x.com`, submits `recipient`, shows error banner on `{ status: "error", error }`. Action bar: `Re-send email…` present for `sent|partial|paid` with `canSendInvoice`, absent for `approved`, absent without permission. Record-payment hint text.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (re-send dialog follows `send-invoice-dialog.tsx` structure: `useDialogActionState`, onSubmit + `startTransition`, close-on-success keyed on state object).
- [ ] **Step 4:** Run the four component tests → PASS; `npm run lint`.
- [ ] **Step 5: Commit** `feat(billing): send and re-send invoice email UI`.

### Task 8: Docs, full suite, manual check

**Files:**
- Delete: `docs/issues/invoice-email-not-sent.md`; remove its row in `docs/issues/README.md`
- Modify: `docs/ROADMAP.md` (Invoice email delivery `[x]`; drop the invoice caveat in "Where we are"), `docs/features/time-and-billing.md` (delivery end state: PDF via Resend, portal link, Invoices folder, failure = ok + warning, re-send), `docs/features/documents.md` only if it lists system folder kinds
- Delete: this plan and the spec

- [ ] **Step 1:** `npm test` → all pass; `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 2: Manual:** `npm run dev` with `RESEND_API_KEY`/`EMAIL_FROM` set, send an approved invoice to a real inbox; confirm From name, Reply-To, portal link, PDF layout against `/print/invoices/[id]`; confirm the "Invoices" folder in Documents. Report anything off.
- [ ] **Step 3:** Update docs as listed.
- [ ] **Step 4: Commit** `docs(billing): invoice email delivery shipped` with explicit paths (including the deletions), then push.
