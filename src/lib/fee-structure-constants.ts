/**
 * Fee-structure values. Display labels live in `billing-type.ts`
 * (`BILLING_TYPE_LABEL`). Not a "use server" file so
 * the constants can be imported anywhere. `matters.feeStructure` is a
 * free String in the schema; these are the values the app writes.
 */

export const FEE_STRUCTURES = [
  "contingent",
  "hourly",
  "flat",
  "hybrid",
  "pro_bono",
] as const;

export type FeeStructure = (typeof FEE_STRUCTURES)[number];
