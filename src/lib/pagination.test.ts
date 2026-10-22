import { describe, expect, test } from "vitest";
import {
  hrefFromSearchParams,
  pageRange,
  pageWindow,
  paginate,
  paginateArray,
  parsePageParam,
  withPageParam,
} from "./pagination";

describe("parsePageParam", () => {
  test.each([
    [undefined, 1],
    ["", 1],
    ["abc", 1],
    ["0", 1],
    ["-3", 1],
    ["2", 2],
    ["2.9", 2],
    [["4", "5"], 4],
  ] as const)("%j → %i", (raw, want) => {
    expect(parsePageParam(raw as string | string[] | undefined)).toBe(want);
  });
});

describe("pageWindow", () => {
  test("clamps past the end to the last page", () => {
    expect(pageWindow(250, 9, 100)).toEqual({
      page: 3,
      pageCount: 3,
      skip: 200,
      take: 100,
    });
  });

  test("an empty list is one page", () => {
    expect(pageWindow(0, 5, 100)).toMatchObject({ page: 1, pageCount: 1, skip: 0 });
  });

  test("NaN and below-one requests become page 1", () => {
    expect(pageWindow(50, Number.NaN, 10).page).toBe(1);
    expect(pageWindow(50, -2, 10).page).toBe(1);
  });
});

describe("paginate", () => {
  test("counts, clamps, then fetches the clamped window", async () => {
    const calls: Array<{ skip: number; take: number }> = [];
    const p = await paginate(
      7,
      10,
      async () => 25,
      async (w) => {
        calls.push(w);
        return ["x"];
      },
    );
    expect(calls).toEqual([{ skip: 20, take: 10 }]);
    expect(p).toEqual({ rows: ["x"], page: 3, pageCount: 3, total: 25, pageSize: 10 });
  });

  test("skips the fetch when nothing matches", async () => {
    let fetched = false;
    const p = await paginate(
      1,
      10,
      async () => 0,
      async () => {
        fetched = true;
        return [];
      },
    );
    expect(fetched).toBe(false);
    expect(p.rows).toEqual([]);
  });
});

test("paginateArray slices a sorted list", () => {
  const p = paginateArray([1, 2, 3, 4, 5], 2, 2);
  expect(p).toEqual({ rows: [3, 4], page: 2, pageCount: 3, total: 5, pageSize: 2 });
});

test("pageRange", () => {
  expect(pageRange({ page: 2, pageSize: 50, total: 120 })).toEqual({ start: 51, end: 100 });
  expect(pageRange({ page: 3, pageSize: 50, total: 120 })).toEqual({ start: 101, end: 120 });
  expect(pageRange({ page: 1, pageSize: 50, total: 0 })).toEqual({ start: 0, end: 0 });
});

describe("withPageParam", () => {
  test("sets the page, keeping other params", () => {
    expect(withPageParam("/x?filter=a", 2)).toBe("/x?filter=a&page=2");
  });

  test("page 1 removes the param (defaults stay out of the URL)", () => {
    expect(withPageParam("/x?page=4&filter=a", 1)).toBe("/x?filter=a");
    expect(withPageParam("/x?page=4", 1)).toBe("/x");
  });
});

test("hrefFromSearchParams keeps repeated keys and drops page", () => {
  expect(
    hrefFromSearchParams("/matters", { q: "a b", area: ["X", "Y"], page: "3", none: undefined }),
  ).toBe("/matters?q=a+b&area=X&area=Y");
  expect(hrefFromSearchParams("/matters", { page: "2" })).toBe("/matters");
});
