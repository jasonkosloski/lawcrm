import { describe, expect, it } from "vitest";
import { parseDateOnly, dateOnlyKey } from "@/lib/format-date";
import { addCalendarDays, computeResponseDue } from "./due-date";

const d = (key: string): Date => {
  const parsed = parseDateOnly(key);
  if (!parsed) throw new Error(`bad key ${key}`);
  return parsed;
};

describe("computeResponseDue", () => {
  it("counts business days from a Friday, skipping the weekend", () => {
    // Fri 10-16 + 3 business days = Mon 10-19, Tue 10-20, Wed 10-21
    expect(dateOnlyKey(computeResponseDue(d("2026-10-16"), 3, "BUSINESS_DAYS"))).toBe("2026-10-21");
  });

  it("counts business days from a Saturday", () => {
    // Sat 10-17 + 3 business days = Mon 10-19, Tue 10-20, Wed 10-21
    expect(dateOnlyKey(computeResponseDue(d("2026-10-17"), 3, "BUSINESS_DAYS"))).toBe("2026-10-21");
  });

  it("counts one business day from a Monday", () => {
    expect(dateOnlyKey(computeResponseDue(d("2026-10-19"), 1, "BUSINESS_DAYS"))).toBe("2026-10-20");
  });

  it("counts calendar days straight through weekends", () => {
    expect(dateOnlyKey(computeResponseDue(d("2026-10-16"), 30, "CALENDAR_DAYS"))).toBe(
      "2026-11-15",
    );
  });

  it("returns UTC-midnight date-only values", () => {
    const due = computeResponseDue(d("2026-10-16"), 3, "BUSINESS_DAYS");
    expect(due.getUTCHours()).toBe(0);
    expect(due.getUTCMinutes()).toBe(0);
  });
});

describe("addCalendarDays", () => {
  it("shifts a date-only value by whole days, across month boundaries", () => {
    expect(dateOnlyKey(addCalendarDays(d("2026-10-30"), 5))).toBe("2026-11-04");
    expect(dateOnlyKey(addCalendarDays(d("2026-10-30"), -30))).toBe("2026-09-30");
  });
});
