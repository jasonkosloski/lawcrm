/**
 * Team form state shapes — shared between the team server actions
 * and the client forms. Lives in a non-"use server" file because
 * server-action files can only export async functions.
 */

export type TeamFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  /** The action succeeded, but a follow-up step (Clerk invite / ban
   *  sync) didn't. Shown to the admin with a suggested retry. */
  warning?: string;
};

export const teamInitialState: TeamFormState = { status: "idle" };
