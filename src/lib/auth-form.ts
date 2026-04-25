/**
 * Auth form state shape — shared between the login server action and
 * the client form. Lives in its own non-"use server" file because
 * server-action files can only export async functions.
 */

export type LoginFormState = {
  status: "idle" | "ok" | "error";
  /** Generic error message — never leaks which field failed (no email
   *  enumeration). The client renders this verbatim. */
  error?: string;
};

export const loginInitialState: LoginFormState = { status: "idle" };
