import { describe, expect, it } from "vitest";
import { formatMoney, percentOf } from "./format";

describe("formatMoney", () => {
  it("rounds and adds separators", () => {
    expect(formatMoney(12345.6)).toBe("$12,346");
  });
});

describe("percentOf", () => {
  it("is 0 when the goal is 0 or negative", () => {
    expect(percentOf(50, 0)).toBe(0);
    expect(percentOf(50, -5)).toBe(0);
  });
  it("rounds and caps at 100", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(500, 100)).toBe(100);
  });
});
