/**
 * Dashboard Preferences — shared types and constants
 *
 * Per-user show/hide settings for the Today/Dashboard cards. Persisted as
 * a JSON blob on `User.dashboardPrefs`. Null or missing keys fall back to
 * the defaults (everything visible) — that way new cards added in the
 * future are visible by default without a backfill.
 *
 * This module is intentionally Prisma-free so it can be imported from
 * both server queries and client components. The DB-touching loader lives
 * in `src/lib/queries/dashboard-prefs.ts`.
 *
 * v2 supports show/hide (`visible`) + reorder (`order`). Ordering is
 * per-column: each card belongs to a fixed column (main / right rail —
 * see DASHBOARD_CARD_COLUMNS) and moves only within it. `order` is still
 * stored as ONE flat array so column membership can change later without
 * a prefs migration. Drag + resize (v3) is tracked in docs/FEATURES.md.
 */

/** Stable identifier for each toggleable surface on the dashboard. */
export const DASHBOARD_CARD_KEYS = [
  "kpis",
  "agenda",
  "tasks",
  "followUps",
  "activity",
  "deadlines",
  "pulse",
] as const;

export type DashboardCardKey = (typeof DASHBOARD_CARD_KEYS)[number];

/** Human-readable labels used in the customize popover. */
export const DASHBOARD_CARD_LABELS: Record<DashboardCardKey, string> = {
  kpis: "KPI tiles",
  agenda: "Today's agenda",
  tasks: "Your tasks",
  followUps: "Follow up today",
  activity: "Recent activity",
  deadlines: "Deadlines this week",
  pulse: "Firm pulse",
};

/**
 * Which dashboard column each card lives in. Ordering moves cards only
 * within their column — the page layout (main column vs. right rail)
 * stays fixed in v2; cross-column moves arrive with drag + resize (v3).
 */
export type DashboardColumn = "main" | "rail";

export const DASHBOARD_CARD_COLUMNS: Record<DashboardCardKey, DashboardColumn> =
  {
    kpis: "main",
    agenda: "main",
    tasks: "main",
    followUps: "main",
    activity: "main",
    deadlines: "rail",
    pulse: "rail",
  };

export type DashboardVisibility = Record<DashboardCardKey, boolean>;

const DEFAULT_VISIBILITY: DashboardVisibility = {
  kpis: true,
  agenda: true,
  tasks: true,
  followUps: true,
  activity: true,
  deadlines: true,
  pulse: true,
};

/**
 * Merge a stored prefs blob with defaults. Pure function — safe to call
 * from anywhere. Tolerates malformed JSON in the DB by falling back to
 * defaults for any unknown / missing / non-boolean keys.
 */
export function mergeVisibility(stored: unknown): DashboardVisibility {
  const merged: DashboardVisibility = { ...DEFAULT_VISIBILITY };
  if (!stored || typeof stored !== "object") return merged;
  const visible = (stored as { visible?: unknown }).visible;
  if (!visible || typeof visible !== "object") return merged;
  for (const key of DASHBOARD_CARD_KEYS) {
    const v = (visible as Record<string, unknown>)[key];
    if (typeof v === "boolean") merged[key] = v;
  }
  return merged;
}

/**
 * Merge a stored prefs blob's `order` with the default order. Same
 * defensive discipline as `mergeVisibility`:
 *   - non-object blob / missing / non-array `order` → default order
 *   - unknown or non-string entries dropped
 *   - duplicates deduped (first occurrence wins)
 *   - known keys missing from the stored array appended in default
 *     order — cards added after the user saved prefs still appear.
 * Always returns a fresh array containing every card key exactly once.
 */
export function mergeOrder(stored: unknown): DashboardCardKey[] {
  const fallback = [...DASHBOARD_CARD_KEYS];
  if (!stored || typeof stored !== "object") return fallback;
  const order = (stored as { order?: unknown }).order;
  if (!Array.isArray(order)) return fallback;

  const known = new Set<string>(DASHBOARD_CARD_KEYS);
  const seen = new Set<DashboardCardKey>();
  const merged: DashboardCardKey[] = [];
  for (const entry of order) {
    if (typeof entry !== "string" || !known.has(entry)) continue;
    const key = entry as DashboardCardKey;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  // New cards (added after the user saved) land at the end, in
  // default order — visible without a backfill, same as visibility.
  for (const key of DASHBOARD_CARD_KEYS) {
    if (!seen.has(key)) merged.push(key);
  }
  return merged;
}

/** The full decoded prefs blob — what the page and popover consume. */
export type DashboardPrefs = {
  visible: DashboardVisibility;
  order: DashboardCardKey[];
};

/** Decode a stored `User.dashboardPrefs` blob into the complete shape. */
export function mergePrefs(stored: unknown): DashboardPrefs {
  return { visible: mergeVisibility(stored), order: mergeOrder(stored) };
}

/** The subset of `order` that renders in the given column, in order. */
export function cardsInColumn(
  order: readonly DashboardCardKey[],
  column: DashboardColumn
): DashboardCardKey[] {
  return order.filter((key) => DASHBOARD_CARD_COLUMNS[key] === column);
}

/**
 * Move a card one slot up/down WITHIN its column. Returns the new full
 * order array, or null when the move is a no-op (card already at its
 * column's edge, or key missing from the array). Swaps the card with
 * its column neighbor in the flat array, so cards in the other column
 * keep their exact positions. Pure — never mutates the input.
 */
export function moveCardInColumn(
  order: readonly DashboardCardKey[],
  key: DashboardCardKey,
  direction: "up" | "down"
): DashboardCardKey[] | null {
  const columnKeys = cardsInColumn(order, DASHBOARD_CARD_COLUMNS[key]);
  const columnIdx = columnKeys.indexOf(key);
  if (columnIdx === -1) return null;
  const neighbor =
    columnKeys[direction === "up" ? columnIdx - 1 : columnIdx + 1];
  if (neighbor === undefined) return null;

  const next = [...order];
  const a = next.indexOf(key);
  const b = next.indexOf(neighbor);
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
