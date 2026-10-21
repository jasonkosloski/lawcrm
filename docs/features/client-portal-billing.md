# Client portal: invoices and trust (sub-project 4)

Read-only. A client sees the invoices the firm issued to them and, if they are the matter's primary client, the matter's trust ledger. Payment stays offline. Parent: [client-portal](client-portal.md). Off until both the firm switch and the per-matter switch are on.

## Switch and keys
- `Matter.portalBillingEnabled` (default false), migration `20261021150000_portal_billing` (expand-only; also grants the new key `portal.share_billing` to roles holding `billing.send_invoice`).
- Staff toggle: Portal card on the matter Overview, "Show billing in the portal". Visible with `portal.view` + `billing.view`; changing it needs `portal.share_billing` + `billing.view` + matter access (`setPortalBilling` in `src/app/actions/portal-billing.ts`; no-op when unchanged; activity "Showed billing in the client portal" / "Hid billing from the client portal"). When on, the card names the billed contacts who have live portal access, or says none do yet.

## Who sees what
All client money reads live in `src/lib/portal/billing.ts` (server-only, identity-scoped). Base gate: `livePortalMatterWhere` (live access, portal on, identity enabled) AND `portalBillingEnabled`.
- **Invoice**: `kind = client`, status `sent` / `partial` / `paid`, and the identity's contact is the billed contact (`Invoice.clientId ?? Matter.clientId`). Never draft, approved, void or `internal_record`.
- **Trust**: only the identity whose contact is the matter's primary client (`Matter.clientId`). Balance plus the full ledger, descriptions included.
- Co-clients who are neither see no money and no Billing section. A guessed invoice id (other matter, other client, hidden status) is a 404.
- Amounts are the stored Decimal columns converted as the staff queries do (no new rounding, ADR-036). Overdue = sent/partial and the due date's calendar day (it is an instant, not a date-only value) is before today in the portal zone, via the shared `invoiceDaysUntilDue`.

Reader: `listPortalInvoices`, `getPortalInvoice` (returns the staff `InvoiceDetail`), `getPortalTrust` (newest first, running balance computed oldest to newest), `canSeePortalBilling`, `portalBalanceDueByMatter`. Staff-side send checks (`resolvePortalSendTarget`, `portalSendAvailability`) are in `src/lib/queries/portal-billing.ts`, deliberately outside the client reader.

## Client UI
- Matter page: Billing section (`billing-section.tsx`) only when the viewer can see money: invoices table (status chip Sent / Partially paid / Paid / Overdue) and, for the primary client, the Trust account card and ledger. Portal home shows "Balance due" on matter rows that have one.
- Invoice page `/matters/[id]/invoices/[invoiceId]`: the printed invoice (`InvoicePreview`, read-only, `printMode`). "Download PDF" opens the browser print dialog; there is no separate print route, the page hides its chrome with print CSS. The invoice shows its notes and payment reference exactly as the printed staff invoice does.
- For an invoice billed to a co-client, the bill-to block shows the matter's client, as the staff print does (the portal shows the same document the firm would mail).

## Send via portal
`sendInvoice` has a third method, "Client portal" (`email` / `mail` / `portal`), in `src/app/actions/billing/payments.ts`. It needs the firm portal on, the matter switch on, and a live portal identity for the billed contact on that matter; otherwise it is refused with the reason, and the Send dialog shows the option disabled with that reason. It runs the normal send flow (status change, optional trust application), then emails only the billed identity `invoicePostedEmail` ("A new invoice is available in your client portal", link to portal home, no amount, no matter name). An email failure never undoes the send; the activity row "Invoice N sent via client portal" notes "— email failed". `email` and `mail` stay logged-only ("not emailed").

## Trust warning
The trust deposit and disbursement forms show "Descriptions are visible to the client in the portal." when the matter's switch is on.

## Open risks and deferred
- No online payment; no server-side PDF or email attachments (PDF is browser print); no automatic updated-invoice email after payments.
- Portal time zone is America/Denver for dates and overdue.
- Co-client bill-to: an invoice billed to a co-client (or after the matter client changes) shows the matter client's bill-to (staff print has the same quirk). Fix later by switching `InvoiceDetail` bill-to to `Invoice.clientId`, which also changes the staff print.
- Notes and payment reference show as printed. If that is too much for the portal, hide the reference in `InvoicePreview` via a prop.
- Tiny window between the send availability check and the send in which a revoke can land; the invoice is still marked sent and the email goes to the identity resolved before the write.
