import { describe, expect, it } from "vitest";
import { capExceeded, monthStart } from "./cap";

describe("capExceeded", () => {
  it("is true at the cap and false just under", () => {
    expect(capExceeded(50 * 3600, 50)).toBe(true);
    expect(capExceeded(50 * 3600 - 1, 50)).toBe(false);
  });
});

describe("monthStart", () => {
  it("uses the tz calendar month", () => {
    expect(monthStart(new Date("2026-11-01T03:00:00Z"), "America/Denver").toISOString()).toBe(
      "2026-10-01T06:00:00.000Z",
    );
  });
  it("handles DST offset months", () => {
    expect(monthStart(new Date("2026-12-15T12:00:00Z"), "America/Denver").toISOString()).toBe(
      "2026-12-01T07:00:00.000Z",
    );
  });
});
