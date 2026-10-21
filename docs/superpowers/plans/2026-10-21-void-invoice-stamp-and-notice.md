# Void Invoice Stamp and Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voiding a sent client invoice stamps every filed PDF of it VOID in place and emails the client the stamped PDF.

**Architecture:** New nullable `Document.invoiceId` links filed PDFs to their invoice (backfilled by name). A new `voidInvoice` server action pre-renders a PDF if none is filed, runs the existing void path, then (post-commit, never failing the void) stamps filed copies with `pdf-lib` and sends a void notice via `sendEmail`. A `VoidInvoiceDialog` replaces the plain confirm for sent client invoices.

**Tech Stack:** Next.js server actions, Prisma (Postgres), Vitest (Docker DB :5433), `pdf-lib`, existing `@react-pdf/renderer` invoice PDF, Resend via `sendEmail`.

**Spec:** `docs/superpowers/specs/2026-10-21-void-invoice-stamp-and-notice-design.md`

## Global Constraints

- Every test run needs the Docker test DB (`docker compose -f docker-compose.test.yml up -d`).
- Migration is expand-only (ADR-058) and ships on push. Create it with `prisma migrate diff` against a local Docker scratch DB (never point Prisma at the `.env` remote dev / prod URL; check `printenv | grep -i database` first), then `npm run check:migrations`.
- Post-commit steps (stamp, file, email) never turn a committed void into an error: `{ status: "ok", warning: "Invoice voided. …" }`.
- Email requires `billing.send_invoice` in addition to `billing.void_invoice`; only for client invoices whose status was `sent`; recipient matches `RECIPIENT_EMAIL_RE` (`/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/`).
- Bytes only server → storage; no bytes through server actions (ADR-034).
- Copy is exact as in the spec (§4 email, §5 warnings/activity titles, §6 UI).
- Commit with explicit pathspec in one step; never leave files staged; end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **Payment races the void**: a payment landing between read and void → error, nothing stamped or emailed (Task 4 test).
2. **Invoice with a filed copy that's missing from storage** (`readStoredFile` returns null) → counted as failed, row untouched, warning (Task 3 test).
3. **Approved-but-never-sent invoice** → no render, no file, no email (Task 4 test).
4. **Hostile matter name in void email** → escaped (Task 2 test).
5. **Double-click Void** → second call refused by the existing conditional write, no second stamp/email (Task 4 test: call twice).

---

### Task 1: `Document.invoiceId` + backfill + filing writes it

**Files:**
- Modify: `prisma/schema.prisma` (Document: `invoiceId String?`, relation `invoice Invoice? @relation(fields: [invoiceId], references: [id], onDelete: SetNull)`, `@@index([invoiceId])`; Invoice: `documents Document[]`)
- Create: `prisma/migrations/<timestamp>_document_invoice_id/migration.sql` (add column, FK, index, then backfill UPDATE from spec §1; columns are the Prisma field names, quoted camelCase, as `@map` isn't used on these fields — verify in existing migrations)
- Modify: `src/lib/billing/invoice-filing.ts` — input gains `invoiceId: string`; `KIND_WORD` gains `void: "void"`; `kind` type widens to `InvoiceEmailKind | "void"`
- Modify: `src/lib/billing/invoice-delivery.ts` (pass `invoiceId`)
- Test: `src/lib/billing/invoice-filing.integration.test.ts`, new `prisma/migrations/…` backfill test in `src/lib/billing/invoice-document-backfill.integration.test.ts` (runs the UPDATE statement read from the migration file against seeded rows)
- Docs: `docs/SCHEMA_NOTES.md` (one entry: `Document.invoiceId`, SetNull, backfilled by name in the Invoices folder)

**Interfaces:**
- Produces: `fileInvoicePdf({ matterId, invoiceId, invoiceNumber, kind: InvoiceEmailKind | "void", bytes, userId, day })` → `{ documentId }`; `Document.invoiceId`.

- [ ] **Step 1:** Failing tests: filing writes `invoiceId`; kind `"void"` names `Invoice 2026-101 (void 2026-10-21).pdf`; backfill links a doc named `Invoice 2026-101 (sent 2026-10-21).pdf` in the invoices folder of the same matter, and does not link one in a non-system folder or another matter, or `Invoice 2026-1010 (…`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Schema, migration (via migrate diff on a scratch DB + appended backfill), `npx prisma generate`, filing/delivery changes. Apply to the test DB the way the repo does (check `src/test` setup / `package.json` scripts).
- [ ] **Step 4:** Tests PASS; `npm run check:migrations`; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(billing): link filed invoice PDFs to their invoice`.

### Task 2: VOID stamp and void email content

**Files:**
- Modify: `package.json`/lockfile (`npm install --save-exact pdf-lib`)
- Create: `src/lib/billing/void-stamp.ts`, `src/lib/billing/void-stamp.test.ts`
- Modify: `src/lib/billing/invoice-email.ts` (+ test file) — add `invoiceVoidEmail`

**Interfaces:**
- Produces: `stampVoid(bytes: Buffer, voidedOn: string): Promise<Buffer>`; `invoiceVoidEmail({ invoiceNumber, firmName, matterName }): { subject, text, html }`.

- [ ] **Step 1:** Failing tests: stamping a PDF from `renderInvoicePdf` (fixture from `invoice-pdf.test.ts`) → starts `%PDF`, same page count (`PDFDocument.load(out).getPageCount()`), extracted text contains the invoice number, `"VOID"` and `"Voided October 21, 2026"`; `stampVoid(Buffer.from("nope"))` rejects. Email: subject `Invoice 2026-101 from Kosloski Law has been voided`; text contains `has been voided and no payment is due on it` and `A copy marked VOID is attached for your records.`; matter `<b>A&B</b>` escaped in html.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per spec §2/§4 (`server-only` on void-stamp).
- [ ] **Step 4:** PASS; tsc.
- [ ] **Step 5:** Commit `feat(billing): VOID stamp and void notice email content`.

### Task 3: Stamp filed copies in place

**Files:**
- Create: `src/lib/billing/void-filing.ts`, `src/lib/billing/void-filing.integration.test.ts`

**Interfaces:**
- Consumes: `stampVoid`, `readStoredFile`/`storeFile`/`deleteFile` (`src/lib/file-storage.ts`).
- Produces: `stampFiledInvoicePdfs({ invoiceId, voidedOn }): Promise<{ stamped: number; failed: number; latest: { name: string; bytes: Buffer } | null }>` — never throws; `latest` = newest stamped doc by `createdAt`.

- [ ] **Step 1:** Failing tests (storage mocked with a `Map` of real bytes): two docs → both rows get new `fileUrl` + `fileSize`, names unchanged, stored bytes are stamped (text contains "VOID"), old keys deleted, `latest.name` is the newer one; a doc whose key is missing (`readStoredFile` → null) → `failed: 1`, row unchanged; conditional update losing (simulate by changing `fileUrl` before the update via a spy) → new key deleted, counted as failed; no docs → `{ stamped: 0, failed: 0, latest: null }`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement per spec §3.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(billing): stamp filed invoice PDFs VOID in place`.

### Task 4: `voidInvoice` action

**Files:**
- Modify: `src/app/actions/billing/lifecycle.ts` (add `voidInvoice`), `src/app/actions/billing/index.ts` (export), move `RECIPIENT_EMAIL_RE` to `src/lib/billing-form.ts` and import it in `payments.ts`
- Create: `src/app/actions/billing.void.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `renderInvoicePdf`, `loadFirmProfileForUser`, `sendEmail`, `logActivity`, `setInvoiceStatusUnchecked` (same file).
- Produces: `voidInvoice(invoiceId: string, _prev: BillingFormState, formData: FormData /* notifyClient, recipient */): Promise<BillingFormState>`.

- [ ] **Step 1:** Failing tests (setup from `billing.email-send.test.ts`), one per spec "Testing → Integration" bullet plus Review Focus 1, 3, 5. Exact strings: activity `Stamped 2 filed PDF(s) of invoice <n> VOID`, `Filed voided copy of invoice <n>`, `Void notice for invoice <n> emailed to <to>`, `Void notice for invoice <n> email failed: <to>`; warnings start `Invoice voided. `; attachment filename `Invoice <n> (VOID).pdf`; email `replyTo` = sender, `fromName` = firm; time entries `invoiceId` null after.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement per spec §5. Pre-void render only when client + `sent` + no doc with this `invoiceId`. Post-commit block wrapped in its own try/catch.
- [ ] **Step 4:** PASS + `billing.flows.test.ts`, `billing.test.ts`, `billing.email-send.test.ts`; tsc.
- [ ] **Step 5:** Commit `feat(billing): void stamps filed PDFs and emails the client`.

### Task 5: Void dialog UI

**Files:**
- Create: `src/components/matters/billing/void-invoice-dialog.tsx`, `void-invoice-dialog.test.tsx`
- Modify: `src/components/matters/billing/invoice-action-bar.tsx` (+ test)

**Interfaces:**
- Consumes: `voidInvoice`, `notifyWarning`/`notifySuccess`.
- Produces: `VoidInvoiceDialog({ open, onOpenChange, invoiceId, invoiceNumber, clientEmail, canSendInvoice })`.

- [ ] **Step 1:** Failing tests: copy exact per spec §6; checkbox + recipient only with `canSendInvoice`; checkbox default checked; recipient required while checked (button disabled when empty); submit sends `notifyClient`/`recipient`; `ok`+`warning` → `notifyWarning` once; ok → `notifySuccess("Invoice voided.")`. Action bar: Void on a sent client invoice opens the dialog (no `confirmAction`); on approved it still calls `confirmAction` + `setInvoiceStatus`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (copy `resend-invoice-dialog.tsx` structure; dialog kept mounted with the others).
- [ ] **Step 4:** PASS (billing component dir); lint.
- [ ] **Step 5:** Commit `feat(billing): void dialog with client notice option`.

### Task 6: Docs, full suite, build

- [ ] Update `docs/features/time-and-billing.md` (void behaviour, end state) and add a shipped `[x]` line in `docs/ROADMAP.md` under Time, billing, money.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` → all pass.
- [ ] Commit `docs(billing): void stamp and notice shipped`. (Controller deletes spec + plan after final review.)
