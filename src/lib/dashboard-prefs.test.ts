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
  DASHBOARD_CARD_COLUMNS,
  DASHBOARD_CARD_KEYS,
  DASHBOARD_CARD_LABELS,
  cardsInColumn,
  mergeOrder,
  mergePrefs,
  mergeVisibility,
  moveCardInColumn,
  type DashboardCardKey,
} from "./dashboard-prefs";

describe("DASHBOARD_CARD_KEYS shape", () => {
  test("non-empty + every key has a label", () => {
    expect(DASHBOARD_CARD_KEYS.length).toBeGreaterThan(0);
    for (const k of DASHBOARD_CARD_KEYS) {
      expect(DASHBOARD_CARD_LABELS[k]).toBeTruthy();
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

describe("mergePrefs", () => {
  test("decodes both halves of the blob", () => {
    const out = mergePrefs({
      visible: { activity: false },
      order: ["pulse", "deadlines"],
    });
    expect(out.visible.activity).toBe(false);
    expect(out.visible.kpis).toBe(true);
    expect(out.order.slice(0, 2)).toEqual(["pulse", "deadlines"]);
    expect(out.order.length).toBe(DASHBOARD_CARD_KEYS.length);
  });

  test("null blob → full defaults", () => {
    const out = mergePrefs(null);
    expect(out.visible.kpis).toBe(true);
    expect(out.order).toEqual(DEFAULT_ORDER);
  });
});

describe("cardsInColumn", () => {
  test("splits the default order by column assignment", () => {
    const main = cardsInColumn(DEFAULT_ORDER, "main");
    const rail = cardsInColumn(DEFAULT_ORDER, "rail");
    expect(main.length + rail.length).toBe(DASHBOARD_CARD_KEYS.length);
    for (const k of main) expect(DASHBOARD_CARD_COLUMNS[k]).toBe("main");
    for (const k of rail) expect(DASHBOARD_CARD_COLUMNS[k]).toBe("rail");
  });

  test("preserves the relative order of the input", () => {
    const order: DashboardCardKey[] = [
      "pulse",
      "activity",
      "deadlines",
      "kpis",
      "agenda",
      "tasks",
      "followUps",
    ];
    expect(cardsInColumn(order, "rail")).toEqual(["pulse", "deadlines"]);
    expect(cardsInColumn(order, "main")[0]).toBe("activity");
  });
});

describe("moveCardInColumn", () => {
  test("moves a card up one slot within its column", () => {
    const out = moveCardInColumn(DEFAULT_ORDER, "agenda", "up");
    expect(out).not.toBeNull();
    expect(cardsInColumn(out!, "main").slice(0, 2)).toEqual([
      "agenda",
      "kpis",
    ]);
  });

  test("moves a card down one slot within its column", () => {
    const out = moveCardInColumn(DEFAULT_ORDER, "kpis", "down");
    expect(cardsInColumn(out!, "main").slice(0, 2)).toEqual([
      "agenda",
      "kpis",
    ]);
  });

  test("returns null at the column edges", () => {
    // First main card can't go up; last rail card can't go down.
    expect(moveCardInColumn(DEFAULT_ORDER, "kpis", "up")).toBeNull();
    expect(moveCardInColumn(DEFAULT_ORDER, "pulse", "down")).toBeNull();
  });

  test("moving a main card never disturbs rail cards (and vice versa)", () => {
    const out = moveCardInColumn(DEFAULT_ORDER, "activity", "up")!;
    expect(cardsInColumn(out, "rail")).toEqual(
      cardsInColumn(DEFAULT_ORDER, "rail")
    );
    const out2 = moveCardInColumn(DEFAULT_ORDER, "pulse", "up")!;
    expect(cardsInColumn(out2, "main")).toEqual(
      cardsInColumn(DEFAULT_ORDER, "main")
    );
  });

  test("column edge respects the CURRENT order, not the default", () => {
    // agenda moved to the top of main — now IT can't go up, but
    // kpis (now second) can.
    const reordered = moveCardInColumn(DEFAULT_ORDER, "agenda", "up")!;
    expect(moveCardInColumn(reordered, "agenda", "up")).toBeNull();
    expect(moveCardInColumn(reordered, "kpis", "up")).not.toBeNull();
  });

  test("does not mutate the input array", () => {
    const input = [...DEFAULT_ORDER];
    moveCardInColumn(input, "agenda", "up");
    expect(input).toEqual(DEFAULT_ORDER);
  });

  test("result is still a permutation of every key", () => {
    const out = moveCardInColumn(DEFAULT_ORDER, "followUps", "down")!;
    expect([...out].sort()).toEqual([...DASHBOARD_CARD_KEYS].sort());
  });
});
