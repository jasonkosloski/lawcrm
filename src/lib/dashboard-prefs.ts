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
 * v1 supports show/hide only. Card order and resize are tracked as
 * follow-up features in docs/FEATURES.md.
 */

/** Stable identifier for each toggleable surface on the dashboard. */
export const DASHBOARD_CARD_KEYS = [
  "kpis",
  "agenda",
  "tasks",
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
  activity: "Recent activity",
  deadlines: "Deadlines this week",
  pulse: "Firm pulse",
};

export type DashboardVisibility = Record<DashboardCardKey, boolean>;

const DEFAULT_VISIBILITY: DashboardVisibility = {
  kpis: true,
  agenda: true,
  tasks: true,
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
