/**
 * Global-search constants — client-safe (no Prisma imports).
 *
 * Canonical home for the values the /search page, the saved-search
 * actions and the ⌘K palette must agree on. `src/lib/queries/search.ts`
 * and `src/lib/queries/saved-searches.ts` re-export them for their
 * long-standing importers; client components import from here so the
 * Prisma-touching query modules stay out of the browser bundle.
 */

export const SEARCH_HIT_TYPES = [
  "matter",
  "contact",
  "lead",
  "note",
  "document",
  "task",
  "deadline",
  "event",
  "email",
  "message",
  "time",
] as const;

export type SearchHitType = (typeof SEARCH_HIT_TYPES)[number];

export function isSearchHitType(v: unknown): v is SearchHitType {
  return (
    typeof v === "string" && (SEARCH_HIT_TYPES as readonly string[]).includes(v)
  );
}

/** Queries shorter than this return no results (too noisy to scan). */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Longest query /search runs or a saved search stores. Generous for a
 *  phrase ("ambulance run report from 3rd Street"), small enough that
 *  a hand-crafted request can't park kilobytes in a row or an ILIKE. */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** The one normalisation every search entry point applies (page,
 *  globalSearch): trim, cap, re-trim so a cut landing after a space
 *  can't leave a trailing blank that skews highlight/snippets. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
}

/** Hard per-user saved-search row cap (a pin board, not an archive). */
export const SAVED_SEARCH_CAP = 50;

/** Saved-search display-name length cap. */
export const SAVED_SEARCH_NAME_MAX = 80;
