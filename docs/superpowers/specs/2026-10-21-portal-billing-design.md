# Client portal: invoices and trust (sub-project 4) design

Tier: Full (money, client visibility, schema, permission key).

## Goal
The client who pays sees the invoices the firm has issued them and the matter's trust account in the portal, can download an invoice as PDF, and is told by email when a new invoice is posted. Read-only; payment stays offline.

Decided with the user (2026-10-21):
- Invoices show only to the billed contact; trust shows only to the matter's primary client. Co-clients see no money.
- Only issued client invoices: status `sent`, `partial`, `paid`. Never draft, approved, void, or `internal_record`.
- Per-matter switch "Show billing in the portal", off by default.
- Sending an invoice gains a "Client portal" method that emails the billed contact.
- Trust: balance plus full ledger including descriptions.
- Out of scope: online payment, server-side PDF / email attachments, automatic updated-invoice emails after payments.

## Approach A: reuse the printed invoice
A portal loader returns the existing `InvoiceDetail` shape (`src/lib/queries/billing.ts`) so the portal renders the existing `InvoicePreview` read-only (no editing, no internal props), and a portal print route reuses the print toolbar's autoprint for "Download PDF" (browser save-as-PDF, like staff today).

## Data
- `Matter.portalBillingEnabled Boolean @default(false)`.
- Migration also grants new key `portal.share_billing` to roles holding `billing.send_invoice`. Expand-only (ADR-058), sorting after the latest existing migration.

## Visibility (server-side, one module)
All client money reads live in `src/lib/portal/billing.ts` (server-only). Base gate: `livePortalMatterWhere(identityId)` (live access + portal on + identity enabled) AND `Matter.portalBillingEnabled`.
- **Billed contact** of an invoice = `Invoice.clientId ?? Matter.clientId`. An invoice is visible to an identity when the base gate passes, `invoice.kind = "client"`, `status in (sent, partial, paid)`, and the identity's `contactId` equals the billed contact.
- **Trust** is visible to an identity when the base gate passes and the identity's `contactId = Matter.clientId`.
- "Can see money on this matter" = can see trust OR at least one visible invoice; otherwise the portal shows no Billing section.
- Overdue display: `status = sent|partial` and `dueDate` (date-only, ADR-012) before today in `PORTAL_TIME_ZONE`.
- Amounts come from the stored Decimal columns converted the same way the staff billing queries do; no new rounding (ADR-036).

Reader functions:
- `listPortalInvoices(identityId, matterId)` → rows `{ id, invoiceNumber, issueDate, dueDate, totalAmount, paidAmount, balance, status, overdue }`, newest issue first.
- `getPortalInvoice(identityId, invoiceId)` → `InvoiceDetail | null` (same rules; null → page 404).
- `getPortalTrust(identityId, matterId)` → `{ balance, entries: { id, date, type, amount, runningBalance, description }[] } | null`, newest first; running balance computed oldest→newest.
- `portalBalanceDueByMatter(identityId, matterIds)` → `Map<matterId, number>` of unpaid visible-invoice balances (> 0 only).

## Client UI
- Portal matter page: **Billing** section (only when the viewer can see money): invoices table (number, issued, due, total, paid, balance, status chip Sent / Partially paid / Paid / Overdue) linking to `/matters/[id]/invoices/[invoiceId]`; **Trust account** card with balance and ledger (date, type label, amount, running balance, description) and the note "Funds held in trust for this matter."
- Invoice page `/matters/[id]/invoices/[invoiceId]` (portal host): the printed-invoice layout via `InvoicePreview` (read-only) and a **Download PDF** button linking to `/matters/[id]/invoices/[invoiceId]/print?autoprint=1`, a chrome-free portal print page reusing the staff print toolbar's autoprint behaviour. Both pages: `requirePortalIdentity` first, then `getPortalInvoice`; null → `notFound()`; the invoice's matter must equal the route's matter.
- Portal home: "Balance due $X" on a matter row when `portalBalanceDueByMatter` has it.

## Staff UI and actions
- Portal card (matter Overview): "Show billing in the portal" switch, shown with `portal.view` + `billing.view`; toggling needs `portal.share_billing` + `billing.view` + matter access. Action `setPortalBilling(matterId, enabled)` in `src/app/actions/portal-billing.ts`: `requirePermissionResult("portal.share_billing")`, `billing.view` check, `assertMatterAccess` inline, no-op if unchanged, `logActivity` ("Showed billing in the client portal" / "Hid billing from the client portal"), revalidate the matter page. When on, the card lists billed contacts with live portal access by name (the matter's client plus distinct `Invoice.clientId`s of issued invoices), or "No billed contact has portal access yet."
- Send invoice (`sendInvoice` in `src/app/actions/billing/payments.ts`): method enum gains `"portal"`. Portal method requires the matter switch on and the billed contact to have a live portal identity on the matter (else `{ ok: false, error: "The billed client doesn't have portal access to this matter." }` or equivalent per the action's existing error shape). It runs the existing send flow (status transition, optional trust application) and then emails only that identity `invoicePostedEmail(portalHomeUrl())` — subject "A new invoice is available in your client portal", no amount, no matter name; skipped while the portal is off. Activity title "Invoice N sent via client portal"; email/mail keep "(not emailed)". The Send dialog shows the method enabled/disabled with the reason (data passed from the page).
- Trust deposit/disbursement forms show "Descriptions are visible to the client in the portal." when `portalBillingEnabled`.

## Edge cases
- Void → hidden. Payments → status/balance update on next render.
- Billed contact loses access → hidden. Switch off → all hidden; on again → back.
- Non-billed co-clients: no Billing section. Internal records and drafts: never, regardless of switch.
- Guessed invoice id (other matter, other client, not visible) → 404 with no detail.

## Testing
- Reader: each visibility rule (switch off; non-billed co-client; draft/approved/void; internal_record; revoked; portal off; disabled identity; clientId-null falls back to Matter.clientId; trust only for the primary client), totals equal the staff `getInvoiceById` totals, running balance correct, balance-due map.
- Pages: guessed/other-matter invoice id → notFound; print page renders with autoprint.
- `setPortalBilling`: keys, `billing.view`, walled matter, no-op, activity.
- `sendInvoice` portal method: refused when switch off / no live billed identity; email only to the billed identity and without amount/matter name; status transition and trust application unchanged; email/mail behaviour and log text unchanged.
- Render: portal Billing section (invoices, trust, empty), invoice page, trust warning on forms, home "Balance due".

## Docs on ship
New `docs/features/client-portal-billing.md` (end state) linked from `client-portal.md` (sub-project 4 → Shipped); update `docs/issues/invoice-email-not-sent.md` (portal posting now notifies; email/mail still logged only) and `docs/features/time-and-billing.md`; ROADMAP lines (client portal; invoice email delivery). Delete this spec and its plan in the finishing commit.
