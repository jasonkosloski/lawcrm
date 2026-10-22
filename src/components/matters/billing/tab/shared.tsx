/**
 * Shared pieces of the matter Billing tab sections: money / date
 * formatters, status + trust-type labels, and the permissions shape.
 */

import { formatDateOnly } from "@/lib/format-date";

// Billing dates on this page are a mix of date-only values (expense /
// payment / trust-transaction dates: shown on their stored calendar
// day, no zone) and instants (invoice issue/due, minted with
// `new Date()`: shown in the viewer's profile zone). ADR-012.
export const formatDay = (d: Date): string => formatDateOnly(d, "medium");

/** Which mutating billing controls the viewer's keys allow. */
export type BillingPermissions = {
  generateInvoice: boolean;
  approveInvoice: boolean;
  sendInvoice: boolean;
  recordPayment: boolean;
  applyTrust: boolean;
  voidInvoice: boolean;
  deleteDraft: boolean;
  recordTrustTransaction: boolean;
};

export const TRUST_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  refund: "Refund",
  transfer: "Transfer",
  interest: "Interest",
};
