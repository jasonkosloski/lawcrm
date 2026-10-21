import { describe, expect, it } from "vitest";
import {
  BILLING_TYPES,
  BILLING_TYPE_LABEL,
  BILLING_TYPE_OPTIONS,
  billingTypeFields,
  billingTypeFromLegacyMode,
  billingTypeOf,
  isBillingType,
} from "./billing-type";

describe("billingTypeFields", () => {
  it("maps every billing type to its fee structure + billing mode", () => {
    expect(billingTypeFields("hourly")).toEqual({
      feeStructure: "hourly",
      billingMode: "client",
    });
    expect(billingTypeFields("flat")).toEqual({
      feeStructure: "flat",
      billingMode: "client",
    });
    expect(billingTypeFields("contingent")).toEqual({
      feeStructure: "contingent",
      billingMode: "client",
    });
    expect(billingTypeFields("court_appointed")).toEqual({
      feeStructure: "hourly",
      billingMode: "court_voucher",
    });
    expect(billingTypeFields("pro_bono")).toEqual({
      feeStructure: "pro_bono",
      billingMode: "none",
    });
  });
});

describe("billingTypeOf", () => {
  it("round-trips every billing type", () => {
    for (const t of BILLING_TYPES) {
      expect(billingTypeOf(billingTypeFields(t))).toBe(t);
    }
  });

  it("reports legacy hybrid", () => {
    expect(
      billingTypeOf({ feeStructure: "hybrid", billingMode: "client" }),
    ).toBe("hybrid");
  });

  it("ignores fee_petition mode and uses the fee structure", () => {
    expect(
      billingTypeOf({ feeStructure: "contingent", billingMode: "fee_petition" }),
    ).toBe("contingent");
    expect(
      billingTypeOf({ feeStructure: "hourly", billingMode: "fee_petition" }),
    ).toBe("hourly");
  });
});

describe("isBillingType", () => {
  it("accepts the five types and rejects hybrid / junk", () => {
    for (const t of BILLING_TYPES) expect(isBillingType(t)).toBe(true);
    expect(isBillingType("hybrid")).toBe(false);
    expect(isBillingType(42)).toBe(false);
  });
});

describe("billingTypeFromLegacyMode", () => {
  it("derives a type from a legacy billing mode", () => {
    expect(billingTypeFromLegacyMode("court_voucher")).toBe("court_appointed");
    expect(billingTypeFromLegacyMode("none")).toBe("pro_bono");
    expect(billingTypeFromLegacyMode("client")).toBe("contingent");
    expect(billingTypeFromLegacyMode("fee_petition")).toBe("contingent");
  });
});

describe("labels and options", () => {
  it("lists the types in order with labels, hybrid labelled but not offered", () => {
    expect(BILLING_TYPES).toEqual([
      "hourly",
      "flat",
      "contingent",
      "court_appointed",
      "pro_bono",
    ]);
    expect(BILLING_TYPE_OPTIONS.map((o) => o.label)).toEqual([
      "Hourly",
      "Flat fee",
      "Contingency",
      "Court-appointed",
      "Pro bono",
    ]);
    expect(BILLING_TYPE_LABEL.hybrid).toBe("Hybrid");
    expect(BILLING_TYPE_OPTIONS.some((o) => o.value === ("hybrid" as never))).toBe(
      false,
    );
  });
});
