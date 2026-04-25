/**
 * Profile form state — shared between /settings/profile and the
 * `updateProfile` server action. Lives in a non-"use server" file
 * because server-action files can only export async functions.
 */

export type ProfileFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const profileInitialState: ProfileFormState = { status: "idle" };
