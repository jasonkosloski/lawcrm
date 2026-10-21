# Portal Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The billed client sees issued invoices and the primary client sees the matter's trust account in the portal (per-matter switch), with PDF download and a "Client portal" send method that emails the billed contact.

**Architecture:** One column (`Matter.portalBillingEnabled`) and one key (`portal.share_billing`). All client money reads in server-only `src/lib/portal/billing.ts`, which gates and then reuses the staff `getInvoiceById` for the invoice body so totals can't drift. Staff toggle in `src/app/actions/portal-billing.ts`; the portal send method extends the existing `sendInvoice`.

**Tech Stack:** Next.js App Router (check `node_modules/next/dist/docs/`), Prisma 7 / Postgres, Zod, Vitest + happy-dom, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-portal-billing-design.md`

## Global Constraints

- Visible invoice: base gate (`livePortalMatterWhere(identityId)` from `src/lib/portal/status.ts` AND `Matter.portalBillingEnabled`) AND `kind = "client"` AND `status in ("sent","partial","paid")` AND identity `contactId` = `Invoice.clientId ?? Matter.clientId`.
- Visible trust: base gate AND identity `contactId` = `Matter.clientId`.
- Overdue: `status in (sent, partial)` and date-only `dueDate` before today in `PORTAL_TIME_ZONE` (`src/lib/portal/time-zone.ts`), compared as date keys (ADR-012).
- Money: never re-round; convert stored Decimals the way `src/lib/queries/billing.ts` does (ADR-036). Balance = total − paid.
- Key exactly `portal.share_billing`; toggle also requires `billing.view` and matter access (`assertMatterAccess` inline in the action).
- Email subject exactly "A new invoice is available in your client portal"; no amount, no matter name; link `portalHomeUrl()`; only to the billed contact's live identity; none while the portal is off.
- Copy: "Show billing in the portal"; "No billed contact has portal access yet."; "Funds held in trust for this matter."; "Descriptions are visible to the client in the portal."; status chips "Sent", "Partially paid", "Paid", "Overdue"; activity "Showed billing in the client portal" / "Hid billing from the client portal" / "Invoice N sent via client portal".
- Migration `20261021150000_portal_billing` (sorts after `20261021140000_portal_messages`), expand-only (ADR-058). Never run Prisma against a non-local DB.
- Portal pages: `requirePortalIdentity()` first; invisible → `notFound()` with no detail.
- Commit with explicit pathspec; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan decision (argued from the spec)
The spec asks for a "chrome-free portal print page reusing the staff print toolbar's autoprint". The portal layout wraps every portal page in a header and footer, and a second route group for one print URL is fragile. Instead the invoice page itself prints chrome-free: the portal header/footer and page controls get `print:hidden`, and "Download PDF" calls `window.print()` (via the existing `PrintToolbar` if it fits, else a tiny client button). Same output, no extra route.

## Review Focus

1. A co-client with live access on a matter whose switch is on, who is neither the billed contact nor the primary client, opens the matter → no Billing section and a guessed invoice URL 404s. Test in Task 2 and Task 4.
2. An invoice whose `clientId` is null on a matter whose client is the viewer → visible; if `Matter.clientId` later changes to someone else → hidden for the old client. Test in Task 2.
3. Staff void an invoice the client already saw → the next portal render shows it gone and the home "Balance due" drops it. Test in Task 2.
4. Portal send when the billed contact's access is revoked → refused with the reason and the invoice status unchanged (no partial send). Test in Task 3.
5. Trust running balance with same-day deposits and disbursements → order stable (date, then createdAt, then id) and final running balance equals the staff trust balance. Test in Task 2.

---

### Task 1: Schema, key, toggle action

**Files:**
- Modify: `prisma/schema.prisma` (Matter field); Create: `prisma/migrations/20261021150000_portal_billing/migration.sql`
- Modify: `src/lib/permissions.ts` (portal group: "Show billing in the client portal")
- Create: `src/app/actions/portal-billing.ts`; Test: `src/app/actions/portal-billing.test.ts`, `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: `setPortalBilling(matterId: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1:** Failing tests: key in catalog; denied without `portal.share_billing`; denied without `billing.view`; walled matter → not-found, unchanged; no-op when unchanged (no activity row); on/off flips the column and writes the two activity titles; revalidates `/matters/${matterId}`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Add column + key; migration `--create-only` against a local scratch DB plus the grant (same SQL shape as `20261021140000_portal_messages`, key `portal.share_billing`, from roles holding `billing.send_invoice`); implement the action mirroring `src/app/actions/portal-status.ts`.
- [ ] **Step 4:** `npx prisma generate`; `npm run check:migrations`; tests PASS (+ `matter-access-guards.test.ts`).
- [ ] **Step 5:** Commit `feat(portal): billing switch, key and migration`.

### Task 2: Client money reader

**Files:**
- Create: `src/lib/portal/billing.ts` (server-only); Test: `src/lib/portal/billing.integration.test.ts`

**Interfaces:**
- Consumes: `livePortalMatterWhere`, `PORTAL_TIME_ZONE`, `getInvoiceById` + `InvoiceDetail` from `src/lib/queries/billing.ts`.
- Produces:
  ```ts
  export type PortalInvoiceRow = { id: string; invoiceNumber: string; issueDate: Date; dueDate: Date; totalAmount: number; paidAmount: number; balance: number; status: "sent" | "partial" | "paid"; overdue: boolean };
  export type PortalTrustEntry = { id: string; date: Date; type: string; amount: number; runningBalance: number; description: string };
  export async function listPortalInvoices(identityId: string, matterId: string): Promise<PortalInvoiceRow[]>;
  export async function getPortalInvoice(identityId: string, invoiceId: string): Promise<(InvoiceDetail & { matterId: string }) | null>;
  export async function getPortalTrust(identityId: string, matterId: string): Promise<{ balance: number; entries: PortalTrustEntry[] } | null>;
  export async function canSeePortalBilling(identityId: string, matterId: string): Promise<boolean>;
  export async function portalBalanceDueByMatter(identityId: string, matterIds: string[]): Promise<Map<string, number>>;
  ```
  `getPortalInvoice` checks visibility with one query, then returns `getInvoiceById(invoiceId)`. Trust entries newest first; running balance computed oldest→newest ordered by `date, createdAt, id`.

- [ ] **Step 1:** Failing tests — each rule from Global Constraints (switch off; non-billed co-client; draft/approved/void; internal_record; revoked; portal off; disabled identity; clientId null → Matter.clientId; Matter.clientId changed → old client loses it; trust only for primary client); overdue in Denver at the day boundary; totals equal `getInvoiceById`; void drops from list and balance-due map; same-day trust ordering and final running balance equal sum of amounts; `canSeePortalBilling` false for a co-client.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): client billing reader`.

### Task 3: Portal send method

**Files:**
- Modify: `src/app/actions/billing/payments.ts` (`sendInvoice`: method enum `"portal"`), `src/lib/portal/emails.ts` (`invoicePostedEmail(link)`)
- Modify: `src/components/matters/billing/send-invoice-dialog.tsx` (+ the page that renders it: pass `portalSend: { available: boolean; reason: string | null }`)
- Test: `src/app/actions/billing.flows.test.ts` (or a new `billing.portal-send.test.ts`), `src/components/matters/billing/send-invoice-dialog.test.tsx`

**Interfaces:**
- Produces: `export async function portalSendAvailability(invoiceId: string): Promise<{ available: boolean; reason: string | null }>` (in `src/lib/portal/billing.ts` or a staff query module — staff-side, called after the billing page's own gates).

- [ ] **Step 1:** Failing tests: portal method refused when the switch is off or the billed contact has no live identity on the matter (reason returned; status unchanged; no email); success runs the existing transition (and trust application when requested), emails only the billed identity, email lacks amount and matter name, no email while portal off, activity title "Invoice N sent via client portal"; email/mail paths and their "(not emailed)" titles unchanged; dialog shows the portal option disabled with the reason, enabled when available.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement: check availability before any write; send the email after the transaction commits; a delivery failure keeps the send and surfaces the action's existing warning shape if it has one (else log and continue).
- [ ] **Step 4:** PASS (+ existing billing flow tests).
- [ ] **Step 5:** Commit `feat(billing): send invoice via client portal`.

### Task 4: Portal UI

**Files:**
- Create: `src/app/(portal)/portal/matters/[id]/billing-section.tsx`, `src/app/(portal)/portal/matters/[id]/invoices/[invoiceId]/page.tsx` (+ a small print button component if `PrintToolbar` doesn't fit)
- Modify: `src/app/(portal)/portal/matters/[id]/page.tsx`, `src/app/(portal)/portal/page.tsx` ("Balance due $X"), `src/app/(portal)/portal/layout.tsx` (`print:hidden` on header/footer)
- Test: beside each

**Interfaces:**
- Consumes: Task 2 reader; `InvoicePreview` (read-only: no `editable`, no staff props) with the firm profile the staff print page uses (`getCurrentFirm`).

- [ ] **Step 1:** Failing tests: Billing section hidden when `canSeePortalBilling` is false; invoices table columns and chips (incl. Overdue); trust card with note, balance and ledger; invoice page renders for a visible invoice, 404s for invisible / other-matter id; Download PDF calls `window.print`; header/footer carry `print:hidden`; home shows "Balance due $X" only for matters in the map, formatted with the app's money formatter.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement per UI_PATTERNS § Client portal.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(portal): invoices and trust on the client portal`.

### Task 5: Staff UI

**Files:**
- Modify: `src/components/matters/portal-card.tsx` (+ its data loader in `src/lib/queries/portal-access.ts`), `src/app/(dashboard)/matters/[id]/page.tsx`, `src/components/matters/billing/trust-transaction-form.tsx` (+ where it's rendered)
- Test: `portal-card.test.tsx`, `trust-transaction-form.test.tsx`, loader test

**Interfaces:**
- Consumes: Task 1 `setPortalBilling`.
- Loader adds `{ portalBillingEnabled: boolean; billedPortalContacts: string[] }` (names of the matter's client and distinct `clientId`s of issued client invoices who have a live identity with access on the matter), only when the viewer has `billing.view`.

- [ ] **Step 1:** Failing tests: switch hidden without `billing.view`; disabled without `portal.share_billing`; toggling calls the action and shows errors; when on, lists billed contacts or "No billed contact has portal access yet."; trust form shows the warning only when enabled.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5:** Commit `feat(portal): billing switch and trust warning in staff UI`.

### Task 6: Docs

**Files:**
- Create: `docs/features/client-portal-billing.md`; Modify: `docs/features/client-portal.md` (sub-project 4 → Shipped, pointer), `docs/features/time-and-billing.md`, `docs/issues/invoice-email-not-sent.md`, `docs/ROADMAP.md` (client portal; invoice email delivery lines).
- Delete (in the final fix commit, after the final review): this plan and the spec.

- [ ] **Step 1:** Write the docs (end state; keep client-portal.md under ~15KB).
- [ ] **Step 2:** Commit `docs(portal): billing shipped`.
