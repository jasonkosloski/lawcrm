/**
 * Settlement constants — shared between server actions, client
 * forms, and read-side components. Lives outside the
 * `"use server"` actions file because that file can only export
 * async functions.
 */

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
