/**
 * Billing types — client-safe.
 *
 * The single user-facing "how do we bill this matter" choice. A billing
 * type maps onto the two stored matter columns, `feeStructure` and
 * `billingMode`, so practice areas can declare which types they allow
 * and matter forms can offer one picker instead of two fields.
 *
 *   hourly / flat / contingent -> same-named fee structure, client billing
 *   court_appointed            -> hourly + court_voucher
 *   pro_bono                   -> pro_bono + none
 *
 * Legacy `hybrid` fee structures still exist in data; they are labelled
 * but never offered. Not a "use server" file and no Prisma import, so
 * forms can import it directly (same pattern as `billing-mode-constants.ts`).
 */

import type { BillingMode } from "./billing-mode-constants";
import type { FeeStructure } from "./fee-structure-constants";

export const BILLING_TYPES = [
  "hourly",
  "flat",
  "contingent",
  "court_appointed",
  "pro_bono",
] as const;

export type BillingType = (typeof BILLING_TYPES)[number];

/// Existing rows may still carry the retired `hybrid` fee structure.
export type BillingTypeOrLegacy = BillingType | "hybrid";

export const BILLING_TYPE_LABEL: Record<BillingTypeOrLegacy, string> = {
  hourly: "Hourly",
  flat: "Flat fee",
  contingent: "Contingency",
  court_appointed: "Court-appointed",
  pro_bono: "Pro bono",
  hybrid: "Hybrid",
};

export const BILLING_TYPE_OPTIONS: Array<{ value: BillingType; label: string }> =
  BILLING_TYPES.map((value) => ({ value, label: BILLING_TYPE_LABEL[value] }));

export function isBillingType(v: unknown): v is BillingType {
  return (BILLING_TYPES as readonly unknown[]).includes(v);
}

/// The stored column pair a billing type writes.
export function billingTypeFields(t: BillingType): {
  feeStructure: FeeStructure;
  billingMode: BillingMode;
} {
  switch (t) {
    case "court_appointed":
      return { feeStructure: "hourly", billingMode: "court_voucher" };
    case "pro_bono":
      return { feeStructure: "pro_bono", billingMode: "none" };
    default:
      return { feeStructure: t, billingMode: "client" };
  }
}

/// Reverse of `billingTypeFields`. `fee_petition` mode is ignored: the
/// fee structure decides. Unrecognized structures fall back to hourly.
export function billingTypeOf(m: {
  feeStructure: string;
  billingMode: string;
}): BillingTypeOrLegacy {
  if (m.billingMode === "court_voucher") return "court_appointed";
  if (m.feeStructure === "hybrid") return "hybrid";
  return isBillingType(m.feeStructure) ? m.feeStructure : "hourly";
}

/// Backfill parity only: derive a type from a legacy billing mode.
export function billingTypeFromLegacyMode(mode: string): BillingType {
  if (mode === "court_voucher") return "court_appointed";
  if (mode === "none") return "pro_bono";
  return "contingent";
}

/// A practice area's stored billing config (plain strings in the DB),
/// narrowed to known types. An invalid default falls back to the first
/// allowed type, then to contingent.
export function normalizeAreaBillingTypes(area: {
  allowedBillingTypes: string[];
  defaultBillingType: string;
}): { allowedBillingTypes: BillingType[]; defaultBillingType: BillingType } {
  const allowedBillingTypes = area.allowedBillingTypes.filter(isBillingType);
  const defaultBillingType = isBillingType(area.defaultBillingType)
    ? area.defaultBillingType
    : (allowedBillingTypes[0] ?? "contingent");
  return { allowedBillingTypes, defaultBillingType };
}
