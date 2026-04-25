/**
 * Billing form state — shared between the billing actions and the
 * client forms. Lives in a non-"use server" file so we can export
 * the type + initial state alongside the actions.
 */

export type BillingFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  /** Returned by generateInvoiceFromWip on success — the page uses
   *  it to focus / scroll to the new invoice row. */
  invoiceId?: string;
  /** Generic error string for actions that don't have field-level
   *  errors (mark-paid, void, etc.). */
  error?: string;
};

export const billingInitialState: BillingFormState = { status: "idle" };

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

/// State machines per kind. Client invoices flow through the full
/// AR lifecycle; internal records skip "sent" (no one's getting
/// the doc) and only transition draft → paid (= "Recorded") → void.
const CLIENT_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "paid", "void"],
  sent: ["paid", "void"],
  open: ["paid", "void"],
  overdue: ["paid", "void"],
  paid: ["void"],
  void: [],
};

const INTERNAL_RECORD_TRANSITIONS: Record<string, string[]> = {
  draft: ["paid", "void"],
  paid: ["void"],
  void: [],
};

/** Allowed status transitions for an invoice, scoped by its kind. */
export function invoiceStatusTransitions(
  status: string,
  kind: InvoiceKind = "client"
): string[] {
  const map =
    kind === "internal_record" ? INTERNAL_RECORD_TRANSITIONS : CLIENT_TRANSITIONS;
  return map[status] ?? [];
}

/// Back-compat for callers that haven't moved to the kind-aware
/// helper yet. New code should call `invoiceStatusTransitions(status, kind)`.
export const INVOICE_STATUS_TRANSITIONS = CLIENT_TRANSITIONS;

const STATUS_LABEL_CLIENT: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  open: "Open",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

const STATUS_LABEL_INTERNAL: Record<string, string> = {
  draft: "Draft",
  // "paid" on an internal record means "bundled and locked" — it's
  // a record, not money received.
  paid: "Recorded",
  void: "Void",
};

/** Display label for an invoice status, scoped by kind so the same
 *  underlying status string reads naturally in both contexts. */
export function invoiceStatusLabel(
  status: string,
  kind: InvoiceKind = "client"
): string {
  const map =
    kind === "internal_record" ? STATUS_LABEL_INTERNAL : STATUS_LABEL_CLIENT;
  return map[status] ?? status;
}

/// Back-compat for callers that haven't moved yet.
export const INVOICE_STATUS_LABEL = STATUS_LABEL_CLIENT;

/// Channels the "Record payment" dialog offers. `trust` is in the
/// list (so the action validates it) but the UI doesn't surface it
/// — the dedicated "Pay from trust" flow handles that case so we
/// can also write the trust ledger leg in the same transaction.
export const INVOICE_PAYMENT_SOURCES = [
  "check",
  "ach",
  "cash",
  "card",
  "other",
  "trust",
] as const;
export type InvoicePaymentSource = (typeof INVOICE_PAYMENT_SOURCES)[number];

/// Display label for a payment source. Used by both the dialog
/// dropdown and the invoice preview's "Payments received" rows.
export const INVOICE_PAYMENT_SOURCE_LABEL: Record<
  InvoicePaymentSource,
  string
> = {
  check: "Check",
  ach: "ACH / wire",
  cash: "Cash",
  card: "Credit card",
  other: "Other",
  trust: "Trust account",
};

/// Trust transaction types the manual composer offers. Interest +
/// transfer are reserved for later automation (bank-feed import).
export const TRUST_TXN_TYPES = ["deposit", "disbursement", "refund"] as const;

export type TrustTxnType = (typeof TRUST_TXN_TYPES)[number];

export const TRUST_TXN_TYPE_LABEL: Record<TrustTxnType, string> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  refund: "Refund to client",
};
