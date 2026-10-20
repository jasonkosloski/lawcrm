/**
 * Shared constants + types for the New Matter form.
 *
 * Lives outside the server-action file because Next.js "use server"
 * modules may only export async functions — non-async exports
 * (constants, types, initial state) break the build.
 */

import type { RecalcChange } from "@/lib/automations/recalc-plan";
import type { ConflictPrompt } from "@/lib/conflict-gate-constants";

/** Sentinel value in the `clientId` dropdown that opens the inline
 *  "create new client" fields on the form. */
export const NEW_CLIENT_SENTINEL = "__new__";

/** Extra team seats on create, posted as JSON in `extraTeam`. */
export type NewMatterTeamSeat = { userId: string; role: string };

/** Shape returned by the create/update matter server actions on
 *  validation error — field errors + echoed values for form re-render. */
export type CreateMatterState = {
  status: "idle" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  /** Conflict gate prompt (ADR-054). */
  conflict?: ConflictPrompt;
};

export const createMatterInitialState: CreateMatterState = {
  status: "idle",
};

/** Update-matter: the create shape plus a "confirm" round-trip — a
 *  changed incident date that would move deadlines counting from it
 *  saves nothing and returns `cascade` for the user to confirm
 *  (ADR-040). */
export type UpdateMatterState = {
  status: "idle" | "error" | "confirm";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  cascade?: RecalcChange[];
  /** Conflict gate prompt (ADR-054) when the client or opposing party
   *  changed. Also carried on a "confirm" state once acknowledged, so
   *  the acknowledgement stays in the form for the confirm resubmit. */
  conflict?: ConflictPrompt;
};
export const updateMatterInitialState: UpdateMatterState = { status: "idle" };
