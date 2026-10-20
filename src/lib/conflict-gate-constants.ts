/**
 * Client-safe shapes for the matter conflict gate (ADR-054). The gate
 * itself (`matter-conflict-gate.ts`) is server-only; forms import the
 * prompt type from here.
 */

/** A conflict-check result the user must act on before the write goes
 *  through: tick "reviewed" (warn) or record an override (conflict).
 *  `matches` are already redacted for the viewer; `fingerprint` is
 *  echoed back as `conflictAck` to acknowledge exactly this result. */
export type ConflictPrompt = {
  severity: "warn" | "conflict";
  matches: Array<{ severity: "warn" | "conflict"; description: string }>;
  fingerprint: string;
  /** Holds `intake.conflict_check.override`. */
  canOverride: boolean;
};
