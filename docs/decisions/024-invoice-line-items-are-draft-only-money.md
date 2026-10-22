# ADR-024: Invoice line items are draft-only; money is rounded per line (HALF_UP, cents)

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Line-item editing was allowed until an invoice was `sent`, so an approver could sign off on a total that then changed, and it was gated only on authorship. Computed amounts (hours x rate, line and invoice totals, payments, trust applications) were stored unrounded, so sub-cent values leaked into totals and aggregates.

**Decision:**

- Approved invoices are not editable in place: line items (hours / rate) can be changed only while the invoice is `draft`, under `billing.generate_invoice` (plus author-or-`time_entries.edit_any`), with the status re-checked under a row lock and an activity-log row written. To change an approved or sent invoice, void it and regenerate from WIP.
- Paying from trust (`recordInvoicePayment` source `trust`) needs `billing.apply_trust`, the same key as the dedicated apply-trust path.
- Every persisted computed amount goes through `roundMoney` (`src/lib/money.ts`): `ROUND_HALF_UP` to 2 dp, applied per line before summing, so the invoice total is the sum of displayed line amounts. Hours are validated to 2 dp on new input.
- Balances are computed from rounded totals, so legacy rows carrying sub-cent values stay payable. Approve and send refuse a $0 client invoice. Outstanding A/R means client invoices in `sent` or `partial` (same as the A/R aging report). `issueDate` and `dueDate` are reset at send with the payment terms preserved. Invoice numbers take their year from the user's profile zone, and the number of a deleted never-sent draft is reused on purpose (gap-free numbering).
- Money-view and generation permissions gate the matching controls in the Billing tab; hiding a button never replaces the server check.
- Status transitions use a status predicate (`updateMany where id and status = expected`); 0 rows is a conflict error. WIP generation links only still-unbilled entries and aborts on a count mismatch.

**Trade-offs:**

- (+) What the approver sees is what is billed; totals reconcile to the cent
- (+) Concurrent approve/send/void/edit can't silently overwrite each other
- (-) Fixing a typo on an approved invoice costs a void and regenerate
- ~~Columns are still wider than 2 dp~~ Money columns are now DECIMAL(14,2) (ADR-036)
