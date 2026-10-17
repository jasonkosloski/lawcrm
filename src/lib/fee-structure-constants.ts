/**
 * Fee-structure values, labels and form options.
 *
 * One source for the matter forms (and for the zod enums / label maps
 * that still hand-copy this list — see docs). Not a "use server" file so
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

export const FEE_STRUCTURE_LABEL: Record<FeeStructure, string> = {
  contingent: "Contingent",
  hourly: "Hourly",
  flat: "Flat fee",
  hybrid: "Hybrid",
  pro_bono: "Pro bono",
};

export const FEE_OPTIONS: Array<{ value: FeeStructure; label: string }> =
  FEE_STRUCTURES.map((value) => ({
    value,
    label: FEE_STRUCTURE_LABEL[value],
  }));
