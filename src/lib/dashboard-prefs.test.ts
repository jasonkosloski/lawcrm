/**
 * Tests for dashboard-prefs — pure JSON-blob decoder. The DB
 * stores user-level visibility prefs as freeform JSON; this
 * function is the boundary that turns "whatever's there" into a
 * complete typed shape.
 *
 * Two invariants worth pinning:
 *   - Defaults to "everything visible" so new cards added later
 *     auto-appear without a backfill.
 *   - Tolerant of garbage in the DB (typed-as-unknown coming in).
 */

import { describe, expect, test } from "vitest";
import {
  DASHBOARD_CARD_KEYS,
  DASHBOARD_CARD_LABELS,
  mergeVisibility,
} from "./dashboard-prefs";

describe("DASHBOARD_CARD_KEYS shape", () => {
  test("non-empty + every key has a label", () => {
    expect(DASHBOARD_CARD_KEYS.length).toBeGreaterThan(0);
    for (const k of DASHBOARD_CARD_KEYS) {
      expect(DASHBOARD_CARD_LABELS[k]).toBeTruthy();
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
