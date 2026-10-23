/**
 * Attorney copy shared with client components (kept apart from
 * attorneys.ts, which imports Prisma and must stay server-only).
 */

/** Shown when the lead attorney has no bar number for the matter's venue. */
export const LEAD_NOT_ATTORNEY = "The lead attorney needs a bar number on file.";

/** Shown when no user has a bar number yet. */
export const NO_ATTORNEYS = "No one has a bar number yet — add one in Settings → Team.";
