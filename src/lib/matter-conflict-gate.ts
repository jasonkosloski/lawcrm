/**
 * Conflict gate for writes that put a client or an adverse party on a
 * matter (ADR-054): creating a matter, changing its client or opposing
 * party / firm on the edit form, and adding an opposing party on the
 * Parties tab. (Lead conversion re-runs the client check itself,
 * ADR-050; a lead carries no adverse party.)
 *
 * Two directions are screened: a client against adverse parties
 * (`runConflictMatcher`) and adverse names against existing clients
 * (`runAdverseConflictMatcher`).
 *
 * The user acknowledges a specific result by echoing its fingerprint
 * (`conflictAck`). If anything that feeds the check changes between
 * the prompt and the resubmit — a different name typed, a party added
 * elsewhere meanwhile — the fingerprint changes and the user is asked
 * again, so a tick or override never covers matches nobody saw.
 */

import { createHash } from "node:crypto";
import {
  runAdverseConflictMatcher,
  runConflictMatcher,
  summarizeMatchSeverity,
  type ConflictCandidate,
  type ConflictCheckResult,
  type ConflictMatch,
} from "@/lib/conflict-check";
import { redactConflictResultForViewer } from "@/lib/conflict-check-redact";
import { currentUserHasPermission } from "@/lib/permission-check";
import type { ConflictPrompt } from "@/lib/conflict-gate-constants";

const CLEAR: ConflictCheckResult = { severity: "clear", matches: [] };

export async function screenMatter(input: {
  /** A client being put on the matter (null: no client change). */
  client: ConflictCandidate | null;
  /** Adverse names being put on the matter. */
  adverseNames: Array<string | null | undefined>;
  /** The matter's own clients, never screened as its adversaries. */
  ownClientIds: string[];
}): Promise<ConflictCheckResult> {
  const [clientSide, adverseSide] = await Promise.all([
    input.client ? runConflictMatcher(input.client) : Promise.resolve(CLEAR),
    runAdverseConflictMatcher(input.adverseNames, input.ownClientIds),
  ]);
  const matches = [...clientSide.matches, ...adverseSide.matches];
  return { severity: summarizeMatchSeverity(matches), matches };
}

/** Stable id for one set of matches (order-independent). Computed on
 *  the unredacted matches, so two viewers see the same fingerprint. */
export function conflictFingerprint(matches: ConflictMatch[]): string {
  const keys = matches
    .map((m) =>
      [m.kind, m.severity, m.matchedField, m.contactId ?? "", m.matterId ?? ""].join(":")
    )
    .sort();
  return createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 16);
}

/** With `keepPrompt`, passed outcomes with matches still carry the
 *  prompt, so a form whose write can still be refused after the gate
 *  (the edit form's deadline cascade, a stale party pick) can keep the
 *  acknowledgement in place for its next submit. */
export type ConflictGateOutcome =
  | { ok: true; outcome: "clear" }
  | { ok: true; outcome: "warn"; matchCount: number; prompt?: ConflictPrompt }
  | {
      ok: true;
      outcome: "override";
      matchCount: number;
      reason: string;
      prompt?: ConflictPrompt;
    }
  | { ok: false; prompt: ConflictPrompt; errors?: Record<string, string[]> };

/**
 * Decide whether a screened write may proceed. Warn needs the
 * fingerprint ticked; conflict needs the fingerprint plus a 5–2000
 * character justification from a holder of
 * `intake.conflict_check.override`. Otherwise returns the prompt
 * (redacted for the viewer) and, where useful, a field error.
 */
export async function evaluateConflictGate(
  screen: ConflictCheckResult,
  posted: { conflictAck?: string; conflictOverrideReason?: string },
  viewerId: string,
  opts: { keepPrompt?: boolean } = {}
): Promise<ConflictGateOutcome> {
  if (screen.severity === "clear") return { ok: true, outcome: "clear" };
  const fingerprint = conflictFingerprint(screen.matches);
  const acknowledged = posted.conflictAck === fingerprint;
  const canOverride =
    screen.severity === "conflict" &&
    (await currentUserHasPermission("intake.conflict_check.override"));
  const reason = (posted.conflictOverrideReason ?? "").trim();
  const matchCount = screen.matches.length;

  // Redaction costs queries: built only when it will be shown.
  const buildPrompt = async (): Promise<ConflictPrompt> => {
    const shown = await redactConflictResultForViewer(viewerId, screen);
    return {
      severity: screen.severity as "warn" | "conflict",
      matches: shown.matches.map((m) => ({
        severity: m.severity,
        description: m.description,
      })),
      fingerprint,
      canOverride,
    };
  };
  const passedPrompt = async () =>
    opts.keepPrompt ? { prompt: await buildPrompt() } : {};

  if (acknowledged && screen.severity === "warn") {
    return { ok: true, outcome: "warn", matchCount, ...(await passedPrompt()) };
  }
  if (acknowledged && canOverride && reason.length >= 5 && reason.length <= 2000) {
    return {
      ok: true,
      outcome: "override",
      matchCount,
      reason,
      ...(await passedPrompt()),
    };
  }

  const prompt = await buildPrompt();

  // An acknowledgement of an earlier, different result: say so, or the
  // user may resubmit without noticing the new matches.
  const stale = !!posted.conflictAck && !acknowledged;
  return {
    ok: false,
    prompt,
    errors: stale
      ? {
          conflictAck: [
            "The conflict check results changed since you reviewed them. Review the list again.",
          ],
        }
      : acknowledged && canOverride
        ? {
            conflictOverrideReason: [
              reason.length > 2000
                ? "Keep the justification under 2000 characters."
                : "Justification is required (5+ characters).",
            ],
          }
        : undefined,
  };
}

/** The matter-timeline entry for a gate that passed with matches: a
 *  plain "clear" stays silent; a reviewed warning or an override (with
 *  its reason) is what compliance review asks about. `action` names the
 *  write, e.g. "Created", "Saved", "Party added". */
export function conflictGateLogEntry(
  gate: Extract<ConflictGateOutcome, { ok: true }>,
  action: string
): { title: string; detail: string } | null {
  if (gate.outcome === "clear") return null;
  const n = gate.matchCount;
  if (gate.outcome === "override") {
    return {
      title: `${action} with conflict check: override`,
      detail: `${n} match${n === 1 ? "" : "es"} overridden: ${gate.reason}`,
    };
  }
  return {
    title: `${action} with conflict check: warn (reviewed)`,
    detail: `${n} possible conflict${n === 1 ? "" : "s"} acknowledged`,
  };
}
