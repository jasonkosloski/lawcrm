/**
 * Tests for matters-filters — URL is the source of truth for the
 * matters list state. The parse + build helpers are the
 * round-trip contract; pin them down so a refactor can't
 * silently change the URL shape.
 */

import { describe, expect, test } from "vitest";
import {
  buildMattersSearchParams,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  EMPTY_FILTER,
  isFilterActive,
  parseMattersParams,
  type MattersFilter,
  type MattersSort,
} from "./matters-filters";

describe("parseMattersParams — empty / defaults", () => {
  test("empty searchParams → EMPTY_FILTER + default sort + default view", () => {
    const r = parseMattersParams({});
    expect(r.filter).toEqual(EMPTY_FILTER);
    expect(r.sort).toEqual(DEFAULT_SORT);
    expect(r.view).toBe(DEFAULT_VIEW);
  });
});

describe("parseMattersParams — single-value scalars", () => {
  test("q is read as a string", () => {
    expect(parseMattersParams({ q: "alvarez" }).filter.q).toBe("alvarez");
  });

  test("trust accepts known values, falls back to 'any' otherwise", () => {
    expect(parseMattersParams({ trust: "has" }).filter.trust).toBe("has");
    expect(parseMattersParams({ trust: "over-10k" }).filter.trust).toBe(
      "over-10k"
    );
    expect(parseMattersParams({ trust: "garbage" }).filter.trust).toBe("any");
  });

  test("deadline accepts known buckets, falls back to 'any' otherwise", () => {
    expect(parseMattersParams({ deadline: "within-7d" }).filter.deadline).toBe(
      "within-7d"
    );
    expect(parseMattersParams({ deadline: "overdue" }).filter.deadline).toBe(
      "overdue"
    );
    expect(parseMattersParams({ deadline: "next-year" }).filter.deadline).toBe(
      "any"
    );
  });

  test("flag params honor exact '1' value, ignore anything else", () => {
    expect(parseMattersParams({ archived: "1" }).filter.includeArchived).toBe(
      true
    );
    expect(parseMattersParams({ archived: "true" }).filter.includeArchived).toBe(
      false
    );
    expect(parseMattersParams({ pinned: "1" }).filter.pinnedOnly).toBe(true);
    expect(parseMattersParams({ show_closed: "1" }).filter.showClosed).toBe(
      true
    );
  });
});

describe("parseMattersParams — multi-value", () => {
  test("repeated `area` collects into the areas array", () => {
    const r = parseMattersParams({
      area: ["§1983", "Housing/FHA"],
    });
    expect(r.filter.areas).toEqual(["§1983", "Housing/FHA"]);
  });

  test("single `area` string still produces a one-element array", () => {
    expect(parseMattersParams({ area: "§1983" }).filter.areas).toEqual([
      "§1983",
    ]);
  });

  test("empty / falsy values get dropped from multi-value arrays", () => {
    const r = parseMattersParams({
      area: ["", "§1983", ""] as unknown as string[],
    });
    expect(r.filter.areas).toEqual(["§1983"]);
  });

  test("missing key → empty array (not undefined)", () => {
    expect(parseMattersParams({}).filter.stages).toEqual([]);
  });
});

describe("parseMattersParams — sort", () => {
  test("known sort + dir are honored", () => {
    expect(parseMattersParams({ sort: "name", dir: "asc" }).sort).toEqual({
      field: "name",
      dir: "asc",
    });
  });

  test("unknown sort field falls back to default", () => {
    expect(parseMattersParams({ sort: "garbage", dir: "asc" }).sort.field).toBe(
      DEFAULT_SORT.field
    );
  });

  test("unknown direction falls back to default", () => {
    expect(parseMattersParams({ sort: "name", dir: "sideways" }).sort.dir).toBe(
      DEFAULT_SORT.dir
    );
  });
});

describe("parseMattersParams — view mode", () => {
  test("known views are honored", () => {
    expect(parseMattersParams({ view: "kanban" }).view).toBe("kanban");
    expect(parseMattersParams({ view: "table" }).view).toBe("table");
  });

  test("unknown view falls back to default", () => {
    expect(parseMattersParams({ view: "cards" }).view).toBe(DEFAULT_VIEW);
  });
});

describe("isFilterActive", () => {
  test("EMPTY_FILTER is not active", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  test.each<[string, Partial<MattersFilter>]>([
    ["q", { q: "alvarez" }],
    ["areas", { areas: ["§1983"] }],
    ["stages", { stages: ["Discovery"] }],
    ["leadIds", { leadIds: ["u1"] }],
    ["feeStructures", { feeStructures: ["contingent"] }],
    ["trust", { trust: "has" }],
    ["deadline", { deadline: "overdue" }],
    ["includeArchived", { includeArchived: true }],
    ["pinnedOnly", { pinnedOnly: true }],
    ["showClosed", { showClosed: true }],
  ])("%s alone marks the filter active", (_label, partial) => {
    expect(isFilterActive({ ...EMPTY_FILTER, ...partial })).toBe(true);
  });
});

describe("buildMattersSearchParams — round-trip", () => {
  test("default state produces an empty query string", () => {
    const p = buildMattersSearchParams(EMPTY_FILTER, DEFAULT_SORT);
    expect(p.toString()).toBe("");
  });

  test("emits multi-value params with append (not set)", () => {
    const p = buildMattersSearchParams(
      {
        ...EMPTY_FILTER,
        areas: ["§1983", "Housing/FHA"],
      },
      DEFAULT_SORT
    );
    expect(p.getAll("area")).toEqual(["§1983", "Housing/FHA"]);
  });

  test("non-default trust + deadline + flags surface", () => {
    const p = buildMattersSearchParams(
      {
        ...EMPTY_FILTER,
        trust: "has",
        deadline: "within-7d",
        includeArchived: true,
        pinnedOnly: true,
        showClosed: true,
      },
      DEFAULT_SORT
    );
    expect(p.get("trust")).toBe("has");
    expect(p.get("deadline")).toBe("within-7d");
    expect(p.get("archived")).toBe("1");
    expect(p.get("pinned")).toBe("1");
    expect(p.get("show_closed")).toBe("1");
  });

  test("non-default sort emits sort + dir; default sort is omitted", () => {
    const customSort: MattersSort = { field: "name", dir: "asc" };
    const p = buildMattersSearchParams(EMPTY_FILTER, customSort);
    expect(p.get("sort")).toBe("name");
    expect(p.get("dir")).toBe("asc");
  });

  test("round-trip: parse(build(x)) === x for a representative state", () => {
    const original = {
      filter: {
        ...EMPTY_FILTER,
        q: "alvarez",
        areas: ["§1983", "Housing/FHA"],
        leadIds: ["user1"],
        trust: "has" as const,
        pinnedOnly: true,
      },
      sort: { field: "name" as const, dir: "asc" as const },
    };
    const url = buildMattersSearchParams(original.filter, original.sort);
    // URLSearchParams → plain object the parser expects.
    const sp: Record<string, string | string[]> = {};
    for (const key of url.keys()) {
      const all = url.getAll(key);
      sp[key] = all.length === 1 ? all[0]! : all;
    }
    const reparsed = parseMattersParams(sp);
    expect(reparsed.filter.q).toBe(original.filter.q);
    expect(reparsed.filter.areas).toEqual(original.filter.areas);
    expect(reparsed.filter.leadIds).toEqual(original.filter.leadIds);
    expect(reparsed.filter.trust).toBe(original.filter.trust);
    expect(reparsed.filter.pinnedOnly).toBe(true);
    expect(reparsed.sort).toEqual(original.sort);
  });
});
