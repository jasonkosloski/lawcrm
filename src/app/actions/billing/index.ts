/**
 * Billing server actions — invoices + trust ledger. This barrel re-exports
 * the actions from their files (generate, line-items, lifecycle, trust,
 * payments) so every caller imports `@/app/actions/billing`; it has no
 * "use server" directive itself — each source file does.
 *
 * What it covers:
 *   - Generate an invoice from WIP time + billable expenses (one
 *     click → draft invoice) or bundle the same WIP into an internal
 *     record (born paid, "Recorded"; no AR).
 *   - Client-invoice lifecycle: draft → approved → sent → partial →
 *     paid, with void available from approved/sent while nothing has
 *     been paid. Drafts can be deleted instead. Payments on every
 *     channel (incl. trust) flow through recordInvoicePayment;
 *     sendInvoice can apply trust at send time.
 *   - Internal-record lifecycle: draft → paid ("Recorded") → void.
 *   - Add manual trust deposits / disbursements / refunds (bumps
 *     `Matter.trustBalance` in the same transaction)
 *
 * Auth model: every mutation gates on a `billing.*` / `trust.*`
 * key from the permission catalog (`src/lib/permissions.ts`):
 *   - generateInvoiceFromWip, bundleAsInternalRecord → billing.generate_invoice
 *   - approveInvoice + the approved/mark-recorded flips  → billing.approve_invoice
 *   - sendInvoice + the sent flip                        → billing.send_invoice
 *   - resendInvoiceEmail                                 → billing.send_invoice
 *   - deleteInvoice                                      → billing.delete_draft
 *   - void flips                                         → billing.void_invoice
 *   - recordInvoicePayment                               → billing.record_payment
 *   - sendInvoice's apply-trust leg                      → billing.apply_trust
 *   - recordInvoicePayment with source=trust             → billing.apply_trust
 *   - addTrustTransaction                                → trust.record_transaction
 *   - updateInvoiceLineItem                              → billing.generate_invoice
 *     (stacked with the author / time_entries.edit_any check of the
 *     standalone time-entry actions; DRAFT invoices only)
 *
 * Decimal correctness: every money operation goes through
 * `Prisma.Decimal` math (`.add()`, `.sub()`) so cents never drift.
 * Numbers from the form are parsed once into Decimal and round-
 * tripped through the DB. Every computed amount that is written
 * (line amounts, invoice totals, payments, trust applications) is
 * rounded to cents with `roundMoney` (HALF_UP, `src/lib/money.ts`).
 *
 * Error hygiene: intentional refusals throw `UserFacingError` and are
 * shown verbatim; any other exception is logged server-side and the
 * client gets a generic message (`toUserMessage`).
 */

export { generateInvoiceFromWip, bundleAsInternalRecord } from "./generate";
export { updateInvoiceLineItem } from "./line-items";
export { setInvoiceStatus, voidInvoice, deleteInvoice, approveInvoice } from "./lifecycle";
export { addTrustTransaction } from "./trust";
export { recordInvoicePayment, sendInvoice, resendInvoiceEmail } from "./payments";
