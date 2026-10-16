import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { hasAtMostDecimals, roundMoney } from "@/lib/money";

describe("roundMoney", () => {
  test("rounds half up at 2 dp (0.25h x 187.50 = 46.875 -> 46.88)", () => {
    const amount = new Prisma.Decimal("187.50").mul(0.25);
    expect(amount.toString()).toBe("46.875");
    expect(roundMoney(amount).toString()).toBe("46.88");
  });

  test("half-up, not banker's rounding", () => {
    expect(roundMoney("0.125").toString()).toBe("0.13");
    expect(roundMoney("0.135").toString()).toBe("0.14");
    expect(roundMoney("2.5").toString()).toBe("2.5");
    expect(roundMoney("1.004").toString()).toBe("1");
  });

  test("accepts number, string and Decimal inputs", () => {
    expect(roundMoney(33.825).toString()).toBe("33.83");
    expect(roundMoney("33.825").toString()).toBe("33.83");
    expect(roundMoney(new Prisma.Decimal("33.825")).toString()).toBe("33.83");
  });

  test("leaves exact cents alone and handles zero", () => {
    expect(roundMoney("12.34").toString()).toBe("12.34");
    expect(roundMoney(0).toString()).toBe("0");
  });

  test("rejects non-finite / non-numeric values", () => {
    expect(() => roundMoney(Number.NaN)).toThrow();
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => roundMoney("abc")).toThrow();
  });
});

describe("hasAtMostDecimals", () => {
  test.each([
    ["1", 2, true],
    ["1.5", 2, true],
    ["1.25", 2, true],
    ["0.123", 2, false],
    ["0.125", 2, false],
    ["abc", 2, false],
    ["", 2, false],
  ] as const)("%s at %i dp -> %s", (v, places, expected) => {
    expect(hasAtMostDecimals(v, places)).toBe(expected);
  });

  test("works on numbers", () => {
    expect(hasAtMostDecimals(0.25, 2)).toBe(true);
    expect(hasAtMostDecimals(0.333, 2)).toBe(false);
  });
});
