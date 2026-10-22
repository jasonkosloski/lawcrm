/**
 * Unit tests for the shared time-entry zod fields. These are the one
 * copy of the hours bound and UTBMS guard that time-entries.ts,
 * time-on-entity.ts and timer.ts all extend, and the error strings are
 * shown in forms / asserted by action tests.
 */

import { describe, expect, test } from "vitest";
import { z } from "zod";
import { hoursField, timeEntryFields, utbmsCodeField } from "./time-entry-schema";

const schema = z.object(timeEntryFields);
const valid = {
  date: "2026-04-01",
  hours: "1.5",
  activity: "Drafting",
};

describe("hoursField", () => {
  test.each(["0.25", "1", "24", "0.01"])("accepts %s", (v) => {
    expect(hoursField.safeParse(v).success).toBe(true);
  });

  test.each(["0", "-1", "24.01", "abc", "NaN", "Infinity"])(
    "rejects %s with the shared message",
    (v) => {
      const res = hoursField.safeParse(v);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]!.message).toBe("Hours must be > 0 and ≤ 24");
      }
    },
  );

  test("empty is 'Hours required'", () => {
    const res = hoursField.safeParse("");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.message).toBe("Hours required");
  });
});

describe("utbmsCodeField", () => {
  test("accepts catalog codes, empty and absent", () => {
    expect(utbmsCodeField.safeParse("A103").success).toBe(true);
    expect(utbmsCodeField.safeParse("").success).toBe(true);
    expect(utbmsCodeField.safeParse(undefined).success).toBe(true);
  });

  test("rejects codes outside the catalog", () => {
    const res = utbmsCodeField.safeParse("BOGUS");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]!.message).toBe("Unknown UTBMS code");
    }
  });
});

describe("timeEntryFields", () => {
  test("a minimal valid post parses", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  test("activity is trimmed and required, capped at 200", () => {
    expect(schema.safeParse({ ...valid, activity: "   " }).success).toBe(false);
    expect(schema.safeParse({ ...valid, activity: "x".repeat(201) }).success).toBe(false);
  });

  test("checkbox fields accept only the literal 'on'", () => {
    expect(schema.safeParse({ ...valid, billable: "on" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, billable: "true" }).success).toBe(false);
  });

  test("date is required but left unparsed (actions use parseDateOnly)", () => {
    expect(schema.safeParse({ ...valid, date: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, date: "2026-02-31" }).success).toBe(true);
  });
});
