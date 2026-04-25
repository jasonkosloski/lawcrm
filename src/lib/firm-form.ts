/**
 * Firm form state — shared between the firm settings page and the
 * `updateFirm` server action. Lives in its own non-"use server" file
 * because server-action files can only export async functions.
 */

export type FirmFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const firmInitialState: FirmFormState = { status: "idle" };
