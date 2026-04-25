/**
 * Billing-mode constants — client-safe.
 *
 * The matter's billing mode shapes which workflow the Billing tab
 * eventually offers — traditional client billing, court-appointed
 * voucher submissions, fee-petition documents for fee-shifting
 * statutes, or "no billing" for true pro-bono / personal matters.
 *
 * iteration 1: schema + select inputs only. Every mode still
 * routes through the traditional UX; the per-mode flows (voucher
 * submission packets, fee-petition court exhibits) land when each
 * has a real demand signal. See docs/MVP_TODO.md billing entry.
 *
 * Lives outside server-only files so the matter / practice-area
 * edit forms can import without dragging Prisma into the client
 * bundle (same pattern as `role-constants.ts`).
 */

export const BILLING_MODES = [
  "client",
  "court_voucher",
  "fee_petition",
  "none",
] as const;

export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABEL: Record<BillingMode, string> = {
  client: "Client billing",
  court_voucher: "Court-appointed (voucher)",
  fee_petition: "Fee petition",
  none: "No billing",
};

/// One-line description for select hints + the "what does this
/// mean?" tooltip on the billing tab. Keep terse.
export const BILLING_MODE_DESCRIPTION: Record<BillingMode, string> = {
  client:
    "Traditional invoicing — generate an invoice from WIP, send to the client, mark paid.",
  court_voucher:
    "Court-appointed work paid by an agency. Generate a voucher document for entry into the agency's reimbursement system (e.g. eVoucher).",
  fee_petition:
    "Contingency / fee-shifting matters. Generate a fee-petition document seeking court-awarded fees (§1988, FHA, Title VII, etc.).",
  none: "No billing on this matter — pro bono / personal / referral.",
};
