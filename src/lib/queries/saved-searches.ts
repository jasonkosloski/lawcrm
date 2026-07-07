/**
 * Saved-search queries — server-only.
 *
 * Drives the "Saved" strip on /search. Identity-scoped exactly like
 * notifications (src/lib/queries/notifications.ts): rows belong to
 * the current user and nobody else, so the gate is
 * `getCurrentUserId()` — no permission key.
 *
 * `SavedSearch.type` is stored as a plain string column; we narrow
 * it through `isSearchHitType` on read so a scope that stops being
 * valid (a removed search type) degrades to "all types" instead of
 * producing a dead ?type= link.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { isSearchHitType, type SearchHitType } from "@/lib/queries/search";

/** Hard per-user row cap, enforced in `createSavedSearch`. Saved
 *  searches are a pin board, not an archive — past ~50 the strip is
 *  unusable anyway. */
export const SAVED_SEARCH_CAP = 50;

/** Display-name length bounds (name defaults to the query text
 *  client-side; see src/components/search/save-search-button.tsx). */
export const SAVED_SEARCH_NAME_MAX = 80;

export type SavedSearchRow = {
  id: string;
  name: string;
  q: string;
  /** Null = all types (no ?type= on the link). */
  type: SearchHitType | null;
};

/** The current user's saved searches, newest first. */
export async function getSavedSearches(): Promise<SavedSearchRow[]> {
  const userId = await getCurrentUserId();
  const rows = await prisma.savedSearch.findMany({
    where: { userId },
    // `id` tiebreak keeps same-timestamp rows in a stable order.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SAVED_SEARCH_CAP,
    select: { id: true, name: true, q: true, type: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    q: r.q,
    type: isSearchHitType(r.type) ? r.type : null,
  }));
}
