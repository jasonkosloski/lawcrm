/**
 * Shared form-state shape for the six inbox action server actions.
 * Lives outside the "use server" file so client components can
 * import the type + initial state.
 */

export type InboxActionFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
};

export const inboxActionInitialState: InboxActionFormState = {
  status: "idle",
};
