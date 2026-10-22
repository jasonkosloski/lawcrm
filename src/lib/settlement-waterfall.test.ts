import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { computeSettlementWaterfall, firmFeeFromPercent } from "@/lib/settlement-waterfall";

const D = (v: string | number) => new Prisma.Decimal(v);

const base = {
  grossAmount: D(100000),
  firmFeePercent: D("33.33"),
  firmFee: D(0),
  advancedCosts: D(0),
  liens: [],
};

describe("firmFeeFromPercent", () => {
  test("exact percent", () => {
    expect(firmFeeFromPercent(D(100000), D("33.33")).toString()).toBe("33330");
  });

  test("rounds half-up at the half-cent (float math gets this wrong)", () => {
    // 10001.05 * 50 = 500052.49999999994 in floats -> 5000.52; exact is 5000.525.
    expect(firmFeeFromPercent(D("10001.05"), D(50)).toString()).toBe("5000.53");
  });

  test.each([
    ["10001.05", "50", "5000.53"],
    ["20000.01", "25", "5000"],
    ["333.33", "33.33", "111.10"],
    ["0.01", "50", "0.01"],
  ])("gross %s at %s%% = %s", (gross, pct, fee) => {
    expect(firmFeeFromPercent(D(gross), D(pct)).toFixed(2)).toBe(D(fee).toFixed(2));
  });
});

describe("computeSettlementWaterfall", () => {
  test("percent drives the fee when set; the stored fee column is ignored", () => {
    const w = computeSettlementWaterfall({ ...base, firmFee: D(1) });
    expect(w.firmFee.toString()).toBe("33330");
    expect(w.clientNet.toString()).toBe("66670");
  });

  test("0% is a real zero fee, not 'use the explicit fee'", () => {
    const w = computeSettlementWaterfall({
      ...base,
      firmFeePercent: D(0),
      firmFee: D(500),
    });
    expect(w.firmFee.toString()).toBe("0");
    expect(w.clientNet.toString()).toBe("100000");
  });

  test("no percent: the explicit fee is used", () => {
    const w = computeSettlementWaterfall({
      ...base,
      firmFeePercent: null,
      firmFee: D("27500.50"),
    });
    expect(w.firmFee.toString()).toBe("27500.5");
  });

  test("negotiated amount overrides the original; null falls back; 0 is a write-off", () => {
    const w = computeSettlementWaterfall({
      ...base,
      liens: [
        { originalAmount: D(5000), negotiatedAmount: D(2500) },
        { originalAmount: D(1000), negotiatedAmount: null },
        { originalAmount: D(800), negotiatedAmount: D(0) },
      ],
    });
    expect(w.lienAmounts.map((a) => a.toNumber())).toEqual([2500, 1000, 0]);
    expect(w.lienTotal.toNumber()).toBe(3500);
    expect(w.clientNet.toString()).toBe("63170");
  });

  test("sums cents exactly (no float dust)", () => {
    const w = computeSettlementWaterfall({
      ...base,
      firmFeePercent: D(0),
      grossAmount: D("0.60"),
      liens: [
        { originalAmount: D("0.10"), negotiatedAmount: null },
        { originalAmount: D("0.20"), negotiatedAmount: null },
      ],
    });
    expect(w.lienTotal.toString()).toBe("0.3");
    expect(w.clientNet.toString()).toBe("0.3");
  });

  test("client net is NOT clamped: deductions over the gross give a negative shortfall", () => {
    // Gross 25,000, 40% fee (10,000), costs 4,000, liens 15,000 -> -4,000.
    const w = computeSettlementWaterfall({
      ...base,
      grossAmount: D(25000),
      firmFeePercent: D(40),
      advancedCosts: D(4000),
      liens: [{ originalAmount: D(15000), negotiatedAmount: null }],
    });
    expect(w.clientNet.toNumber()).toBe(-4000);
  });

  test("fee, lien total and net agree to the cent on a half-cent gross", () => {
    const w = computeSettlementWaterfall({
      ...base,
      grossAmount: D("10001.05"),
      firmFeePercent: D(50),
      advancedCosts: D("0.01"),
      liens: [{ originalAmount: D("1000.02"), negotiatedAmount: null }],
    });
    expect(w.firmFee.toFixed(2)).toBe("5000.53");
    expect(D("10001.05").sub(w.firmFee).sub("0.01").sub(w.lienTotal).toFixed(2)).toBe(
      w.clientNet.toFixed(2),
    );
  });
});
