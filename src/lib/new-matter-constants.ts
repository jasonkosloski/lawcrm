/**
 * Shared constants + types for the New Matter form.
 *
 * Lives outside the server-action file because Next.js "use server"
 * modules may only export async functions — non-async exports
 * (constants, types, initial state) break the build.
 */

/** Sentinel value in the `clientId` dropdown that opens the inline
 *  "create new client" fields on the form. */
export const NEW_CLIENT_SENTINEL = "__new__";

/** Shape returned by the create/update matter server actions on
 *  validation error — field errors + echoed values for form re-render. */
export type CreateMatterState = {
  status: "idle" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const createMatterInitialState: CreateMatterState = {
  status: "idle",
};

/** Update-matter shares the same shape — alias keeps callsites readable. */
export type UpdateMatterState = CreateMatterState;
export const updateMatterInitialState: UpdateMatterState = { status: "idle" };
