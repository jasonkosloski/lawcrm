/**
 * Dashboard Preferences - shared types and constants
 *
 * Per-user layout of the Today/Dashboard cards (placement, split and a
 * hidden tray), persisted as a JSON blob on `User.dashboardPrefs`. Null
 * or missing data falls back to the default layout, and cards added
 * later land in their default zone without a backfill.
 *
 * This module is intentionally Prisma-free so it can be imported from
 * both server queries and client components. The DB-touching loader lives
 * in `src/lib/queries/dashboard-prefs.ts`.
 *
 * v3 stores a band + 1-3 column layout (`DashboardLayout`): a full-width
 * band of cards on top, then a column split (`DashboardSplit`) whose
 * columns each hold an ordered stack of cards, plus a `hidden` tray.
 * `mergeLayout` is the single decoder; it also converts legacy v2 blobs
 * (`visible` + `order`) so no DB migration is needed. The v2 helpers
 * (`mergeVisibility`, `mergeOrder`, `DASHBOARD_CARD_COLUMNS`) remain for
 * that conversion.
 */

/** Stable identifier for each toggleable surface on the dashboard. */
export const DASHBOARD_CARD_KEYS = [
  "kpis",
  "triage",
  "agenda",
  "tasks",
  "followUps",
  "activity",
  "deadlines",
  "pulse",
  "records",
] as const;

export type DashboardCardKey = (typeof DASHBOARD_CARD_KEYS)[number];

/** Where a card lands when a stored layout doesn't mention it. */
export type CardPlacement = { zone: "band" } | { zone: "column"; index: number };

/**
 * Card registry: label (shown in the customizer) + default placement
 * (used by `mergeLayout` for cards missing from a stored layout, so new
 * cards appear without a backfill). New cards register here.
 */
export const DASHBOARD_CARDS: Record<
  DashboardCardKey,
  { label: string; defaultPlacement: CardPlacement }
> = {
  kpis: { label: "KPI tiles", defaultPlacement: { zone: "band" } },
  triage: { label: "Needs me now", defaultPlacement: { zone: "band" } },
  agenda: {
    label: "Today's agenda",
    defaultPlacement: { zone: "column", index: 0 },
  },
  tasks: {
    label: "Your tasks",
    defaultPlacement: { zone: "column", index: 0 },
  },
  followUps: {
    label: "Follow up today",
    defaultPlacement: { zone: "column", index: 0 },
  },
  activity: {
    label: "Recent activity",
    defaultPlacement: { zone: "column", index: 0 },
  },
  deadlines: {
    label: "Deadlines this week",
    defaultPlacement: { zone: "column", index: 1 },
  },
  pulse: {
    label: "Firm pulse",
    defaultPlacement: { zone: "column", index: 1 },
  },
  records: {
    label: "Records to chase",
    defaultPlacement: { zone: "column", index: 1 },
  },
};

/**
 * Which legacy (v1/v2) column each card lived in. Only used to convert
 * stored v2 blobs to the v3 layout; v3 placement is `DashboardLayout`.
 */
export type DashboardColumn = "main" | "rail";

export const DASHBOARD_CARD_COLUMNS: Record<DashboardCardKey, DashboardColumn> = {
  kpis: "main",
  triage: "main",
  agenda: "main",
  tasks: "main",
  followUps: "main",
  activity: "main",
  deadlines: "rail",
  pulse: "rail",
  records: "rail",
};

export type DashboardVisibility = Record<DashboardCardKey, boolean>;

const DEFAULT_VISIBILITY: DashboardVisibility = {
  kpis: true,
  triage: true,
  agenda: true,
  tasks: true,
  followUps: true,
  activity: true,
  deadlines: true,
  pulse: true,
  records: true,
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

// ── v3: band + columns layout ─────────────────────────────────────────

/** Column split of the grid below the band, as 12-grid spans. */
export type DashboardSplit = "8/4" | "4/8" | "6/6" | "4/4/4" | "12";

export const DASHBOARD_SPLITS: readonly DashboardSplit[] = ["8/4", "4/8", "6/6", "4/4/4", "12"];

/** Each column's span out of 12, per split. Length = column count. */
export type SplitSpan = 4 | 6 | 8 | 12;

export const SPLIT_SPANS: Record<DashboardSplit, SplitSpan[]> = {
  "8/4": [8, 4],
  "4/8": [4, 8],
  "6/6": [6, 6],
  "4/4/4": [4, 4, 4],
  "12": [12],
};

/** The decoded per-user dashboard layout (`User.dashboardPrefs`, v3). */
export type DashboardLayout = {
  v: 3;
  split: DashboardSplit;
  /** Full-width cards rendered above the columns. */
  band: DashboardCardKey[];
  /** One ordered stack per column; length always matches the split. */
  columns: DashboardCardKey[][];
  hidden: DashboardCardKey[];
};

/** What a new user and "Reset" get: the v2 page plus the triage card. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  v: 3,
  split: "8/4",
  band: ["kpis", "triage"],
  columns: [
    ["agenda", "tasks", "followUps", "activity"],
    ["deadlines", "pulse", "records"],
  ],
  hidden: [],
};

/** Where a card can be moved to. */
export type LayoutTarget =
  { zone: "band" } | { zone: "column"; index: number } | { zone: "hidden" };

function freshDefault(): DashboardLayout {
  return {
    ...DEFAULT_LAYOUT,
    band: [...DEFAULT_LAYOUT.band],
    columns: DEFAULT_LAYOUT.columns.map((c) => [...c]),
    hidden: [...DEFAULT_LAYOUT.hidden],
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const KNOWN_KEYS = new Set<string>(DASHBOARD_CARD_KEYS);

/** Convert a legacy v2 blob (`visible` + `order`) to a v3 layout. */
function layoutFromV2(stored: unknown): DashboardLayout {
  const rawOrder = (stored as { order?: unknown }).order;
  // A band-default card the stored blob never mentioned is left out so
  // `mergeLayout` places it in the band (the triage card lands there,
  // not at the foot of a column).
  const mentioned = (k: DashboardCardKey) => Array.isArray(rawOrder) && rawOrder.includes(k);
  const visible = mergeVisibility(stored);
  const order = mergeOrder(stored).filter(
    (k) => mentioned(k) || !visible[k] || DASHBOARD_CARDS[k].defaultPlacement.zone !== "band",
  );
  const main = order.filter((k) => DASHBOARD_CARD_COLUMNS[k] === "main");
  const rail = order.filter((k) => DASHBOARD_CARD_COLUMNS[k] === "rail");
  const kpisFirst = main[0] === "kpis";
  const shown = (k: DashboardCardKey) => visible[k];
  return {
    v: 3,
    split: "8/4",
    band: kpisFirst && shown("kpis") ? ["kpis"] : [],
    columns: [main.filter((k) => !(kpisFirst && k === "kpis") && shown(k)), rail.filter(shown)],
    hidden: order.filter((k) => !shown(k)),
  };
}

/**
 * Decode a stored `User.dashboardPrefs` blob into a complete, valid v3
 * layout. Rules, in order: non-object → default; v2 blob (no `v: 3`) →
 * converted; v3 blob → sanitized (unknown split → 8/4, junk keys
 * dropped, each key once with band > columns > hidden precedence,
 * columns folded/padded to the split's column count); finally any known
 * card missing from the result is placed in its default zone so cards
 * added after the user saved still appear. Always returns fresh arrays.
 */
export function mergeLayout(stored: unknown): DashboardLayout {
  if (!isPlainObject(stored)) return freshDefault();
  if (stored.v !== 3) return mergeLayout(layoutFromV2(stored));

  const split: DashboardSplit = DASHBOARD_SPLITS.includes(stored.split as DashboardSplit)
    ? (stored.split as DashboardSplit)
    : "8/4";
  const colCount = SPLIT_SPANS[split].length;

  const seen = new Set<DashboardCardKey>();
  const clean = (list: unknown): DashboardCardKey[] => {
    const out: DashboardCardKey[] = [];
    if (!Array.isArray(list)) return out;
    for (const e of list) {
      if (typeof e !== "string" || !KNOWN_KEYS.has(e)) continue;
      const key = e as DashboardCardKey;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };

  const band = clean(stored.band);
  const rawCols = Array.isArray(stored.columns) ? stored.columns : [];
  const cleaned = rawCols.map(clean);
  const columns: DashboardCardKey[][] = [];
  for (let i = 0; i < colCount; i++) columns.push(cleaned[i] ?? []);
  // Extra columns (from a wider split) fold onto the end of the last one.
  for (let i = colCount; i < cleaned.length; i++) {
    columns[colCount - 1].push(...cleaned[i]);
  }
  const hidden = clean(stored.hidden);

  for (const key of DASHBOARD_CARD_KEYS) {
    if (seen.has(key)) continue;
    const p = DASHBOARD_CARDS[key].defaultPlacement;
    if (p.zone === "band") band.push(key);
    else columns[Math.min(p.index, colCount - 1)].push(key);
  }
  return { v: 3, split, band, columns, hidden };
}

/**
 * Move a card to a zone, removing it from wherever it was. Inserts at
 * `position` (default: end; clamped) - an index into the target list
 * AFTER the card has been removed (matters when reordering within one
 * list). A column index past the last column lands in the last.
 * Pure - returns a new layout.
 */
export function moveCard(
  layout: DashboardLayout,
  key: DashboardCardKey,
  to: LayoutTarget,
  position?: number,
): DashboardLayout {
  const without = (list: DashboardCardKey[]) => list.filter((k) => k !== key);
  const next: DashboardLayout = {
    ...layout,
    band: without(layout.band),
    columns: layout.columns.map(without),
    hidden: without(layout.hidden),
  };
  const target =
    to.zone === "band"
      ? next.band
      : to.zone === "hidden"
        ? next.hidden
        : next.columns[Math.max(0, Math.min(to.index, next.columns.length - 1))];
  const at =
    position === undefined ? target.length : Math.max(0, Math.min(position, target.length));
  target.splice(at, 0, key);
  return next;
}

/** Change the column split, re-folding/padding columns via `mergeLayout`. */
export function setSplit(layout: DashboardLayout, split: DashboardSplit): DashboardLayout {
  return mergeLayout({ ...layout, split });
}

/** Structural equality — used to skip a save when nothing changed. */
export function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  const eq = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((k, i) => k === y[i]);
  return (
    a.split === b.split &&
    eq(a.band, b.band) &&
    eq(a.hidden, b.hidden) &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => eq(c, b.columns[i]))
  );
}
