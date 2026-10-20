/**
 * Conflict gate for the direct create path (`/matters/new`).
 *
 * Lead conversion re-runs the client-side matcher (ADR-050); a matter
 * created by hand has no lead, so the gate runs here instead and
 * screens BOTH directions: the client against existing adverse
 * parties (`runConflictMatcher`) and the typed opposing party / firm
 * against existing clients (`runAdverseConflictMatcher`).
 *
 * The user acknowledges a specific result by echoing its fingerprint
 * (`conflictAck`). If anything that feeds the check changes between
 * the prompt and the resubmit — a different client typed, a party
 * added elsewhere meanwhile — the fingerprint changes and the user is
 * asked again, so a tick or override never covers matches nobody saw.
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

export async function screenNewMatter(input: {
  client: ConflictCandidate | null;
  opposingParty: string | null;
  opposingFirm: string | null;
}): Promise<ConflictCheckResult> {
  const [clientSide, adverseSide] = await Promise.all([
    input.client
      ? runConflictMatcher(input.client)
      : Promise.resolve<ConflictCheckResult>({ severity: "clear", matches: [] }),
    runAdverseConflictMatcher(
      [input.opposingParty, input.opposingFirm],
      input.client?.ownContactId
    ),
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
