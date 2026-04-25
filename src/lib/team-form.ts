/**
 * Team form state shapes — shared between the team server actions
 * and the client forms. Lives in a non-"use server" file because
 * server-action files can only export async functions.
 */

export type TeamFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  /** Surfaced after a successful invite — gives the admin a chance
   *  to copy + share the temporary password. Null on edit/reset/etc.
   *  Today this is the only path to deliver creds since email
   *  delivery is deferred. */
  invitePassword?: string;
  /** Surfaced after a successful password reset — same reason. */
  resetPassword?: string;
};

export const teamInitialState: TeamFormState = { status: "idle" };
