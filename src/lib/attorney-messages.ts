/**
 * Attorney copy shared with client components (kept apart from
 * attorneys.ts, which imports Prisma and must stay server-only).
 */

/** Shown when the lead attorney isn't an attorney (holds no bar admission). */
export const LEAD_NOT_ATTORNEY = "The lead attorney needs a bar number on file.";

/** Shown when no user has a bar number yet. */
export const NO_ATTORNEYS =
  "No one has a bar number yet — add yours in Settings → Profile, or a teammate's in Settings → Team.";
