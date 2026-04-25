/**
 * Shared form-state shape for the deadline edit dialog.
 * Lives outside `app/actions/deadlines.ts` because `"use server"`
 * files can only export async functions.
 */

export type UpdateDeadlineFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<
    Record<
      "title" | "dueDate" | "kind" | "sourceRef" | "description" | "status",
      string[]
    >
  >;
};

export const updateDeadlineInitialState: UpdateDeadlineFormState = {
  status: "idle",
};
