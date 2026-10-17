import { describe, expect, it } from "vitest";
import { resolvePoolMax } from "./prisma";

describe("resolvePoolMax", () => {
  it("defaults to a pool larger than 1 (Fluid compute shares the pool)", () => {
    expect(resolvePoolMax(undefined)).toBe(5);
    expect(resolvePoolMax(undefined)).toBeGreaterThan(1);
  });

  it("honors a positive integer override", () => {
    expect(resolvePoolMax("1")).toBe(1);
    expect(resolvePoolMax("12")).toBe(12);
  });

  it("falls back to the default for junk, zero, negative or fractional values", () => {
    for (const raw of ["", "abc", "0", "-3", "2.5", "NaN"]) {
      expect(resolvePoolMax(raw)).toBe(5);
    }
  });
});

describe("integration pool", () => {
  it("the test harness runs with a multi-connection pool so concurrency tests overlap", () => {
    // integration-setup.ts sets DATABASE_POOL_MAX before workers start.
    expect(resolvePoolMax(process.env.DATABASE_POOL_MAX)).toBeGreaterThan(1);
  });
});
