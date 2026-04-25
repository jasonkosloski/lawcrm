/**
 * Shared form-state shape for the task edit dialog.
 *
 * Lives outside `app/actions/tasks.ts` because `"use server"` files can
 * only export async functions — no consts, no types-with-runtime-shape
 * (initialState is a plain object).
 */

export type UpdateTaskFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<Record<"title" | "description" | "dueDate" | "priority" | "status", string[]>>;
};

export const updateTaskInitialState: UpdateTaskFormState = { status: "idle" };
