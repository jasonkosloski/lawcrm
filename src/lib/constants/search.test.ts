/**
 * The search constants are shared by server queries, server actions
 * and client components. These tests pin the cross-module contracts
 * that used to be hand-mirrored (and could silently drift).
 */

import { describe, expect, test } from "vitest";
import {
  isSearchHitType,
  normalizeSearchQuery,
  SAVED_SEARCH_NAME_MAX,
  SEARCH_HIT_TYPES,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
} from "./search";
import { SCOPE_SEARCH_TYPE } from "@/components/command-palette/prefix";
import { TYPE_META } from "@/components/search/search-results";

describe("search constants", () => {
  test("every hit type has a results-page label/icon and isSearchHitType accepts it", () => {
    for (const t of SEARCH_HIT_TYPES) {
      expect(TYPE_META[t]).toBeDefined();
      expect(isSearchHitType(t)).toBe(true);
    }
    expect(Object.keys(TYPE_META).sort()).toEqual([...SEARCH_HIT_TYPES].sort());
  });

  test("palette scopes only map to real search types", () => {
    for (const t of Object.values(SCOPE_SEARCH_TYPE)) {
      if (t !== null) expect(isSearchHitType(t)).toBe(true);
    }
  });

  test("thresholds are sane", () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
    expect(SEARCH_QUERY_MAX_LENGTH).toBeGreaterThan(SAVED_SEARCH_NAME_MAX);
  });
});

describe("normalizeSearchQuery", () => {
  test("trims, caps, and re-trims a cut that lands after a space", () => {
    const raw = "a".repeat(SEARCH_QUERY_MAX_LENGTH - 1) + " tail";
    const q = normalizeSearchQuery(`  ${raw}  `);
    expect(q).toBe("a".repeat(SEARCH_QUERY_MAX_LENGTH - 1));
    expect(q.endsWith(" ")).toBe(false);
  });
});
