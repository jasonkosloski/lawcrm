import { describe, expect, test } from "vitest";
import { firstParam } from "./search-params";

describe("firstParam", () => {
  test("passes a single value through and takes the first of many", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
  });
});
