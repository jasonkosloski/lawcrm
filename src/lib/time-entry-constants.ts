/**
 * Shared types + initial state for the event-scoped time entry form.
 * Kept out of the "use server" action file because those can only
 * export async functions.
 */

export type TimeEntryFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const timeEntryInitialState: TimeEntryFormState = { status: "idle" };
