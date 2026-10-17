import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format-money";

describe("formatMoney", () => {
  it("always shows cents by default", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(12000)).toBe("$12,000.00");
  });

  it("puts the sign before the currency symbol", () => {
    expect(formatMoney(-50.25)).toBe("-$50.25");
  });

  it("never renders negative zero", () => {
    expect(formatMoney(-0)).toBe("$0.00");
  });

  it("can round to whole dollars for dashboards", () => {
    expect(formatMoney(1234.56, { cents: false })).toBe("$1,235");
  });
});
