/**
 * Settlement status constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Settlement.status, SettlementLien.status,
 * and SettlementApproval.status value sets (see the schema doc
 * comments). The settlement actions previously inlined these as
 * anonymous z.enum arrays; they now validate against these.
 */

export const SETTLEMENT_STATUSES = [
  "pending",
  "approved",
  "disbursed",
  "closed",
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  disbursed: "Disbursed",
  closed: "Closed",
};

export const SETTLEMENT_LIEN_STATUSES = [
  "pending",
  "negotiating",
  "signed",
  "verified",
  "paid",
] as const;

export type SettlementLienStatus = (typeof SETTLEMENT_LIEN_STATUSES)[number];

export const SETTLEMENT_LIEN_STATUS_LABEL: Record<
  SettlementLienStatus,
  string
> = {
  pending: "Pending",
  negotiating: "Negotiating",
  signed: "Signed",
  verified: "Verified",
  paid: "Paid",
};

export const SETTLEMENT_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type SettlementApprovalStatus =
  (typeof SETTLEMENT_APPROVAL_STATUSES)[number];
