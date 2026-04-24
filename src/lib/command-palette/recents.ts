/**
 * Command-palette "recent items" storage (localStorage).
 *
 * Stores up to MAX_RECENTS references (kind + id) that the user has
 * selected from the palette. Newest first. Duplicates are de-duped
 * (most recent wins). When the palette opens with an empty query we
 * surface these first so repeat destinations feel frictionless.
 */

const STORAGE_KEY = "lawcrm:palette:recents";
const MAX_RECENTS = 6;

export type RecentRef = {
  kind: "matter" | "contact" | "lead" | "user" | "nav";
  /** For kind='nav', this is the destination id (e.g. "nav:matters"). */
  id: string;
};

export function readRecents(): RecentRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentRef =>
        r &&
        typeof r === "object" &&
        typeof r.kind === "string" &&
        typeof r.id === "string"
    );
  } catch {
    return [];
  }
}

export function pushRecent(ref: RecentRef): void {
  if (typeof window === "undefined") return;
  const current = readRecents();
  const deduped = [
    ref,
    ...current.filter((r) => !(r.kind === ref.kind && r.id === ref.id)),
  ].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
  } catch {
    // localStorage may be disabled (Safari private mode, quota); recents
    // are a nice-to-have, so swallow silently.
  }
}
