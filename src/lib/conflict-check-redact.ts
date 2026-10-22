/**
 * Matter wall for the DISPLAY of a conflict-check result. Lives apart
 * from `conflict-check.ts` so the (pure-ish) matcher doesn't pull the
 * session-aware matter-access module into its import graph.
 */

import type { ConflictMatch } from "@/lib/conflict-check";
import { filterAccessibleMatterIds } from "@/lib/matter-access";

/** Shown in place of a hit's description when it names a matter the
 *  viewer can't access. */
export const RESTRICTED_MATCH_DESCRIPTION =
  "Match on a restricted matter - details hidden. Ask an administrator or the matter's team before proceeding.";

/**
 * Matter wall for the DISPLAY of a conflict result. The matcher itself
 * always scans every matter (a conflict check that can't see a wall
 * would silently clear real conflicts - the worst failure for an ethics
 * check) and the persisted status uses the true severity. But the hit
 * LIST names matters, so for a viewer who can't access a hit's matter
 * the hit is kept (severity unchanged) while its description is
 * replaced with a generic line and its `matterId` dropped.
 */
export async function redactConflictResultForViewer<T extends { matches: ConflictMatch[] }>(
  viewerId: string,
  result: T,
): Promise<T> {
  const ids = result.matches.flatMap((m) => (m.matterId ? [m.matterId] : []));
  if (ids.length === 0) return result;
  const accessible = await filterAccessibleMatterIds(viewerId, ids);
  return {
    ...result,
    matches: result.matches.map((m) => {
      if (!m.matterId || accessible.has(m.matterId)) return m;
      return {
        ...m,
        description: RESTRICTED_MATCH_DESCRIPTION,
        matterId: undefined,
      };
    }),
  };
}
