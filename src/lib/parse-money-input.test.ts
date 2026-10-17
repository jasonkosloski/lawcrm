import { describe, expect, test } from "vitest";
import { parseMoneyInput } from "./parse-money-input";

describe("parseMoneyInput — mirrors the server's amount schema", () => {
  test("strips thousands separators (parseFloat would read 1)", () => {
    expect(parseMoneyInput("1,200.00")).toBe(1200);
    expect(parseFloat("1,200.00")).toBe(1); // the bug this replaces
  });

  test("strips a leading dollar sign (parseFloat would be NaN)", () => {
    expect(parseMoneyInput("$500")).toBe(500);
    expect(parseMoneyInput("$1,234.5")).toBe(1234.5);
  });

  test("accepts whole numbers and 1-2 decimals, trimming outer space", () => {
    expect(parseMoneyInput(" 42 ")).toBe(42);
    expect(parseMoneyInput("0.05")).toBe(0.05);
    expect(parseMoneyInput("10.5")).toBe(10.5);
  });

  test("rejects what the server rejects", () => {
    for (const bad of ["", "abc", "12.345", "-5", "1e3", "5.", ".5", "1 000"]) {
      expect(parseMoneyInput(bad), bad).toBeNull();
    }
  });
});
