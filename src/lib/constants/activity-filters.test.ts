/**
 * The audit page's type pills must be reachable and consistent:
 * every pill in PILL_ORDER has a bucket, calls and documents are
 * not stranded under "All", and no type appears under two pills.
 */

import { describe, expect, test } from "vitest";
import { ACTIVITY_FILTER_BUCKETS, ACTIVITY_PILL_ORDER } from "@/lib/constants/activity-filters";

describe("activity filter buckets", () => {
  test("every pill has a bucket and every bucket has a pill", () => {
    expect([...ACTIVITY_PILL_ORDER].sort()).toEqual(Object.keys(ACTIVITY_FILTER_BUCKETS).sort());
  });

  test("logged calls, documents and evidence have a pill", () => {
    const typeToPill = new Map<string, string>();
    for (const [key, b] of Object.entries(ACTIVITY_FILTER_BUCKETS)) {
      for (const t of b.types) typeToPill.set(t, key);
    }
    expect(typeToPill.get("call")).toBe("communications");
    expect(typeToPill.get("email")).toBe("communications");
    expect(typeToPill.get("document")).toBe("documents");
    expect(typeToPill.get("evidence")).toBe("evidence");
  });

  test("no activity type sits under two pills", () => {
    const seen = new Set<string>();
    for (const b of Object.values(ACTIVITY_FILTER_BUCKETS)) {
      for (const t of b.types) {
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });
});
