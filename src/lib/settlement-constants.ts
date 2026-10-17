/**
 * Settlement constants — shared between server actions, client
 * forms, and read-side components. Lives outside the
 * `"use server"` actions file because that file can only export
 * async functions.
 */

/** Lienholder kinds offered by the lien form and accepted by
 *  addSettlementLien — one list so the form and the server can't
 *  drift apart. */
export const LIENHOLDER_TYPES = [
  "hospital",
  "physician",
  "insurance",
  "government",
  "other",
] as const;

export type LienholderType = (typeof LIENHOLDER_TYPES)[number];

export const LIENHOLDER_TYPE_LABEL: Record<LienholderType, string> = {
  hospital: "Hospital",
  physician: "Physician",
  insurance: "Insurance / subrogation",
  government: "Government (Medicare/Medicaid)",
  other: "Other",
};

export type SettlementFormState = {
  status: "idle" | "ok" | "error";
  /** Mirrors `zod.flatten().fieldErrors` — value may be undefined
   *  per zod's typing. The UI checks `errs.foo?.[0]` everywhere. */
  errors?: Record<string, string[] | undefined>;
  error?: string;
};

export const settlementInitialState: SettlementFormState = {
  status: "idle",
};
