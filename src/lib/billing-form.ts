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

/// Statuses an invoice can transition into via the row-action
/// menu. Drafts go to sent or void; sent goes to paid or void;
/// paid is terminal (well, void is the escape hatch for fixing
/// a mistakenly-marked-paid invoice).
export const INVOICE_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "paid", "void"],
  sent: ["paid", "void"],
  open: ["paid", "void"],
  overdue: ["paid", "void"],
  paid: ["void"],
  void: [],
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  open: "Open",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
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
