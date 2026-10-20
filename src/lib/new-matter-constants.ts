/**
 * Shared constants + types for the New Matter form.
 *
 * Lives outside the server-action file because Next.js "use server"
 * modules may only export async functions — non-async exports
 * (constants, types, initial state) break the build.
 */

import type { RecalcChange } from "@/lib/automations/recalc-plan";

/** Sentinel value in the `clientId` dropdown that opens the inline
 *  "create new client" fields on the form. */
export const NEW_CLIENT_SENTINEL = "__new__";

/** A conflict-check result the user must act on before the matter is
 *  created: tick "reviewed" (warn) or record an override (conflict).
 *  `matches` are already redacted for the viewer; `fingerprint` is
 *  echoed back as `conflictAck` to acknowledge exactly this result. */
export type NewMatterConflict = {
  severity: "warn" | "conflict";
  matches: Array<{ severity: "warn" | "conflict"; description: string }>;
  fingerprint: string;
  /** Holds `intake.conflict_check.override`. */
  canOverride: boolean;
};

/** Extra team seats on create, posted as JSON in `extraTeam`. */
export type NewMatterTeamSeat = { userId: string; role: string };

/** Shape returned by the create/update matter server actions on
 *  validation error — field errors + echoed values for form re-render. */
export type CreateMatterState = {
  status: "idle" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  conflict?: NewMatterConflict;
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
};
export const updateMatterInitialState: UpdateMatterState = { status: "idle" };
