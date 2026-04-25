/**
 * Role form state — shared between /settings/roles and the role
 * server actions. Lives in a non-"use server" file because
 * server-action files can only export async functions.
 */

export type RoleFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const roleInitialState: RoleFormState = { status: "idle" };
