/**
 * Invoice status + kind constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Invoice.status / Invoice.kind value sets.
 * The lifecycle LOGIC (transition machine, void/delete guards,
 * kind-scoped labels) stays in `src/lib/billing-form.ts` — this file
 * is just the value sets, and billing-form re-exports the kind
 * constants for its long-standing importers.
 *
 * Client invoices flow draft → approved → sent → partial → paid,
 * with void allowed at pre-payment steps; internal records only do
 * draft → paid ("Recorded") → void. (The schema doc comment on
 * Invoice.status predates the approved/partial refactor.)
 */

export const INVOICE_STATUSES = [
  "draft",
  "approved",
  "sent",
  "partial",
  "paid",
  "void",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/// Kind of invoice — see Invoice.kind on the schema. The "client"
/// kind is the traditional bill-to-client AR invoice; "internal_record"
/// is a record-of-work bundle for contingency / pro-bono cases that
/// resolve without a fee petition.
export const INVOICE_KINDS = ["client", "internal_record"] as const;

export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  client: "Client invoice",
  internal_record: "Internal record",
};
