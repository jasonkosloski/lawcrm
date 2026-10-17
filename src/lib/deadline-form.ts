/**
 * Shared form-state shape for the deadline edit dialog.
 * Lives outside `app/actions/deadlines.ts` because `"use server"`
 * files can only export async functions.
 */

import type { RecalcChange } from "@/lib/automations/recalc-plan";

export type UpdateDeadlineFormState = {
  /** "confirm": the new date would move other deadlines that count
   *  from this one — nothing was saved; `cascade` lists them for the
   *  user to confirm (ADR-040). */
  status: "idle" | "ok" | "error" | "confirm";
  cascade?: RecalcChange[];
  errors?: Partial<
    Record<
      "title" | "dueDate" | "kind" | "sourceRef" | "description" | "status" | "_form",
      string[]
    >
  >;
};

export const updateDeadlineInitialState: UpdateDeadlineFormState = {
  status: "idle",
};
