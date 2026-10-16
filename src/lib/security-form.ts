/**
 * Change-password form state — shared between /settings/security and
 * `changePasswordAction`. Lives in a non-"use server" file because
 * server-action files can only export async functions.
 */

export type ChangePasswordFormState = {
  status: "idle" | "ok" | "error";
  /** Field → messages. `_form` holds errors not tied to one field. */
  errors?: Record<string, string[]>;
};

export const changePasswordInitialState: ChangePasswordFormState = {
  status: "idle",
};
