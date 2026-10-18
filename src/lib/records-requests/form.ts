/**
 * Form state for the records-request actions. Lives outside the
 * "use server" actions file, which may only export async functions.
 */

export type RecordsRequestFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const recordsRequestInitialState: RecordsRequestFormState = {
  status: "idle",
};
