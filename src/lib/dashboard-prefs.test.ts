/**
 * Tests for dashboard-prefs — pure JSON-blob decoders. The DB
 * stores user-level card prefs (`visible` + `order`) as freeform
 * JSON; these functions are the boundary that turns "whatever's
 * there" into a complete typed shape.
 *
 * Two invariants worth pinning:
 *   - Defaults to "everything visible" so new cards added later
 *     auto-appear without a backfill.
 *   - Tolerant of garbage in the DB (typed-as-unknown coming in).
 */

import { describe, expect, test } from "vitest";
import {
  DASHBOARD_CARDS,
  DASHBOARD_CARD_COLUMNS,
  DASHBOARD_CARD_KEYS,
  DEFAULT_LAYOUT,
  layoutsEqual,
  mergeLayout,
  mergeOrder,
  mergeVisibility,
  moveCard,
  setSplit,
  type DashboardLayout,
} from "./dashboard-prefs";

describe("records card", () => {
  test("is a column-1 card, labelled, and visible by default", () => {
    expect(DASHBOARD_CARD_KEYS).toContain("records");
    expect(DASHBOARD_CARDS.records.label).toBe("Records to chase");
    expect(DASHBOARD_CARDS.records.defaultPlacement).toEqual({
      zone: "column",
      index: 1,
    });
    expect(mergeVisibility(null).records).toBe(true);
  });
});

describe("DASHBOARD_CARD_KEYS shape", () => {
  test("non-empty + every key has a label", () => {
    expect(DASHBOARD_CARD_KEYS.length).toBeGreaterThan(0);
    for (const k of DASHBOARD_CARD_KEYS) {
      expect(DASHBOARD_CARDS[k].label).toBeTruthy();
    }
  });

  test("every key has a column assignment", () => {
    for (const k of DASHBOARD_CARD_KEYS) {
      expect(["main", "rail"]).toContain(DASHBOARD_CARD_COLUMNS[k]);
    }
  });

  test("known core keys are present (regression guard)", () => {
    // Removing one of these would silently break the dashboard
    // — the section just stops rendering. Asserting them here
    // makes the change show up in CI as a test failure.
    expect(DASHBOARD_CARD_KEYS).toContain("kpis");
    expect(DASHBOARD_CARD_KEYS).toContain("agenda");
    expect(DASHBOARD_CARD_KEYS).toContain("activity");
  });
});

describe("mergeVisibility — fallthroughs", () => {
  test("null / undefined → all defaults true", () => {
    const out = mergeVisibility(null);
    for (const k of DASHBOARD_CARD_KEYS) {
      expect(out[k]).toBe(true);
    }
  });

  test("non-object input → all defaults", () => {
    expect(mergeVisibility(42).kpis).toBe(true);
    expect(mergeVisibility("garbage").agenda).toBe(true);
    expect(mergeVisibility(true).activity).toBe(true);
  });

  test("missing 'visible' key → all defaults", () => {
    expect(mergeVisibility({}).kpis).toBe(true);
    expect(mergeVisibility({ other: 1 }).kpis).toBe(true);
  });

  test("'visible' wrapped in non-object → all defaults", () => {
    expect(mergeVisibility({ visible: "garbage" }).kpis).toBe(true);
    expect(mergeVisibility({ visible: null }).kpis).toBe(true);
  });
});

describe("mergeVisibility — applies stored values", () => {
  test("a stored false value flips the corresponding card off", () => {
    const out = mergeVisibility({ visible: { activity: false } });
    expect(out.activity).toBe(false);
    // Other cards still default to true.
    expect(out.kpis).toBe(true);
    expect(out.agenda).toBe(true);
  });

  test("multiple stored values apply independently", () => {
    const out = mergeVisibility({
      visible: { kpis: false, deadlines: false, pulse: true },
    });
    expect(out.kpis).toBe(false);
    expect(out.deadlines).toBe(false);
    expect(out.pulse).toBe(true);
    expect(out.agenda).toBe(true); // untouched → default
  });
});

describe("mergeVisibility — defensive against bad types", () => {
  test("non-boolean values for a known key fall through to default", () => {
    // Old blobs from a buggier version, or hand-edited DB rows.
    expect(
      mergeVisibility({ visible: { kpis: "false" } }).kpis
    ).toBe(true);
    expect(mergeVisibility({ visible: { kpis: 0 } }).kpis).toBe(true);
    expect(mergeVisibility({ visible: { kpis: null } }).kpis).toBe(true);
  });

  test("unknown card keys in the blob are silently ignored", () => {
    const out = mergeVisibility({
      visible: { kpis: false, garbage: false, ghosts: true },
    });
    expect(out.kpis).toBe(false);
    // No "garbage" key on the typed result; assertion uses
    // index access so TS doesn't complain.
    expect((out as Record<string, boolean>).garbage).toBeUndefined();
  });

  test("returns a fresh object — caller can mutate without affecting defaults", () => {
    const a = mergeVisibility({ visible: { kpis: false } });
    a.kpis = true;
    const b = mergeVisibility(null);
    expect(b.kpis).toBe(true);
  });
});

// ── mergeOrder — mirrors mergeVisibility's defensive discipline ──────

const DEFAULT_ORDER = [...DASHBOARD_CARD_KEYS];

describe("mergeOrder — fallthroughs", () => {
  test("null / undefined → default order", () => {
    expect(mergeOrder(null)).toEqual(DEFAULT_ORDER);
    expect(mergeOrder(undefined)).toEqual(DEFAULT_ORDER);
  });

  test("non-object input → default order", () => {
    expect(mergeOrder(42)).toEqual(DEFAULT_ORDER);
    expect(mergeOrder("garbage")).toEqual(DEFAULT_ORDER);
    expect(mergeOrder(true)).toEqual(DEFAULT_ORDER);
  });

  test("missing 'order' key → default order", () => {
    expect(mergeOrder({})).toEqual(DEFAULT_ORDER);
    expect(mergeOrder({ visible: { kpis: false } })).toEqual(DEFAULT_ORDER);
  });

  test("'order' that isn't an array → default order", () => {
    expect(mergeOrder({ order: "garbage" })).toEqual(DEFAULT_ORDER);
    expect(mergeOrder({ order: { kpis: 0 } })).toEqual(DEFAULT_ORDER);
    expect(mergeOrder({ order: null })).toEqual(DEFAULT_ORDER);
  });
});

describe("mergeOrder — applies stored values", () => {
  test("a complete stored order is returned verbatim", () => {
    const stored = [...DASHBOARD_CARD_KEYS].reverse();
    expect(mergeOrder({ order: stored })).toEqual(stored);
  });

  test("partial stored order keeps its prefix, appends the rest in default order", () => {
    // User saved prefs before "followUps"/"pulse" existed — new
    // cards must still appear, at the end, in default relative order.
    const out = mergeOrder({ order: ["activity", "kpis"] });
    expect(out.slice(0, 2)).toEqual(["activity", "kpis"]);
    expect(out).toEqual([
      "activity",
      "kpis",
      ...DEFAULT_ORDER.filter((k) => k !== "activity" && k !== "kpis"),
    ]);
  });
});

describe("mergeOrder — defensive against bad entries", () => {
  test("unknown card keys are dropped", () => {
    const out = mergeOrder({ order: ["garbage", "kpis", "ghosts"] });
    expect(out[0]).toBe("kpis");
    expect(out).not.toContain("garbage");
    expect(out.length).toBe(DASHBOARD_CARD_KEYS.length);
  });

  test("non-string entries are dropped", () => {
    const out = mergeOrder({ order: [42, null, { key: "kpis" }, "agenda"] });
    expect(out[0]).toBe("agenda");
    expect(out.length).toBe(DASHBOARD_CARD_KEYS.length);
  });

  test("duplicates are deduped — first occurrence wins", () => {
    const out = mergeOrder({ order: ["pulse", "kpis", "pulse", "kpis"] });
    expect(out.slice(0, 2)).toEqual(["pulse", "kpis"]);
    expect(out.filter((k) => k === "pulse").length).toBe(1);
    expect(out.length).toBe(DASHBOARD_CARD_KEYS.length);
  });

  test("always returns every key exactly once (permutation invariant)", () => {
    const nasty = { order: ["deadlines", "deadlines", 7, "nope", "kpis"] };
    const out = mergeOrder(nasty);
    expect([...out].sort()).toEqual([...DASHBOARD_CARD_KEYS].sort());
  });

  test("returns a fresh array — caller can mutate without affecting defaults", () => {
    const a = mergeOrder(null);
    a.reverse();
    expect(mergeOrder(null)).toEqual(DEFAULT_ORDER);
  });
});

// ── v3 layout model ───────────────────────────────────────────────────

const ALL = [...DASHBOARD_CARD_KEYS].sort();
const keysIn = (l: DashboardLayout) =>
  [...l.band, ...l.columns.flat(), ...l.hidden].sort();

describe("mergeLayout", () => {
  test("null / garbage → DEFAULT_LAYOUT", () => {
    for (const s of [null, undefined, 42, "x", []]) {
      expect(mergeLayout(s)).toEqual(DEFAULT_LAYOUT);
    }
  });

  test("empty v2 blob converts to the default", () => {
    expect(mergeLayout({})).toEqual(DEFAULT_LAYOUT);
  });

  test("v2: kpis first in main → band", () => {
    const l = mergeLayout({
      order: ["kpis", "tasks", "agenda", "followUps", "activity", "records", "deadlines", "pulse"],
    });
    expect(l.band).toEqual(["kpis"]);
    expect(l.columns).toEqual([
      ["tasks", "agenda", "followUps", "activity"],
      ["records", "deadlines", "pulse"],
    ]);
  });

  test("v2: kpis not first stays in column 0 at its position", () => {
    const l = mergeLayout({
      order: ["agenda", "kpis", "tasks", "followUps", "activity", "deadlines", "pulse", "records"],
    });
    expect(l.band).toEqual([]);
    expect(l.columns[0]).toEqual(["agenda", "kpis", "tasks", "followUps", "activity"]);
  });

  test("v2: visible:false → hidden, removed from zones", () => {
    const l = mergeLayout({ visible: { pulse: false, kpis: false } });
    expect([...l.hidden].sort()).toEqual(["kpis", "pulse"]);
    expect(l.band).toEqual([]);
    expect(l.columns[1]).toEqual(["deadlines", "records"]);
  });

  test("v3: duplicates — first occurrence wins band → columns → hidden", () => {
    const l = mergeLayout({
      v: 3,
      split: "8/4",
      band: ["agenda"],
      columns: [["agenda", "tasks"], ["tasks"]],
      hidden: ["agenda"],
    });
    // agenda keeps its band slot; kpis (missing) is appended to the band
    // by its default placement.
    expect(l.band).toEqual(["agenda", "kpis"]);
    expect(l.columns[0][0]).toBe("tasks");
    expect(keysIn(l)).toEqual(ALL);
  });

  test("v3: unknown keys and non-strings dropped; unknown split → 8/4", () => {
    const l = mergeLayout({ v: 3, split: "9/3", band: ["nope", 7], columns: "x", hidden: [] });
    expect(l.split).toBe("8/4");
    expect(keysIn(l)).toEqual(ALL);
  });

  test("v3: missing keys land in their default zone (column index clamped)", () => {
    const l = mergeLayout({ v: 3, split: "12", band: [], columns: [["agenda"]], hidden: [] });
    expect(l.band).toEqual(["kpis"]);
    expect(l.columns).toHaveLength(1);
    expect(l.columns[0].slice(-3)).toEqual(["deadlines", "pulse", "records"]);
  });

  test("v3: too many columns fold into the last; too few pad", () => {
    const l = mergeLayout({
      v: 3,
      split: "8/4",
      band: [],
      columns: [["agenda"], ["tasks"], ["pulse"]],
      hidden: [],
    });
    expect(l.columns[1].slice(0, 2)).toEqual(["tasks", "pulse"]);
    expect(
      mergeLayout({ v: 3, split: "4/4/4", band: [], columns: [], hidden: [] }).columns
    ).toHaveLength(3);
  });
});

describe("moveCard", () => {
  test("column → band at position, hidden, and back", () => {
    let l = moveCard(DEFAULT_LAYOUT, "deadlines", { zone: "band" }, 0);
    expect(l.band).toEqual(["deadlines", "kpis"]);
    l = moveCard(l, "deadlines", { zone: "hidden" });
    expect(l.hidden).toEqual(["deadlines"]);
    l = moveCard(l, "deadlines", { zone: "column", index: 9 });
    expect(l.columns[1].at(-1)).toBe("deadlines");
    expect(DEFAULT_LAYOUT.band).toEqual(["kpis"]); // no mutation
  });

  test("keeps every card exactly once", () => {
    const l = moveCard(DEFAULT_LAYOUT, "agenda", { zone: "column", index: 1 }, 1);
    expect(keysIn(l)).toEqual(ALL);
    expect(l.columns[1][1]).toBe("agenda");
  });
});

describe("setSplit", () => {
  test("round trip 4/4/4 → 12 → 8/4 keeps every card once", () => {
    const l = setSplit(setSplit(setSplit(DEFAULT_LAYOUT, "4/4/4"), "12"), "8/4");
    expect(keysIn(l)).toEqual(ALL);
    expect(l.columns).toHaveLength(2);
  });
});

describe("layoutsEqual", () => {
  test("structural compare", () => {
    expect(layoutsEqual(DEFAULT_LAYOUT, mergeLayout(null))).toBe(true);
    expect(layoutsEqual(DEFAULT_LAYOUT, setSplit(DEFAULT_LAYOUT, "6/6"))).toBe(false);
    expect(
      layoutsEqual(DEFAULT_LAYOUT, moveCard(DEFAULT_LAYOUT, "kpis", { zone: "hidden" }))
    ).toBe(false);
  });
});
