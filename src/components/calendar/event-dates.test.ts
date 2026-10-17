import { describe, expect, test } from "vitest";
import { parseDateOnly } from "@/lib/format-date";
import { formatHours } from "@/lib/format-hours";
import { eventTimeEntryDate } from "./event-dates";

const TZ = "America/Denver";
// Wed Oct 14 2026, 10:00 AM in Denver.
const NOW = new Date("2026-10-14T16:00:00.000Z");

describe("eventTimeEntryDate", () => {
  test("a past timed event defaults to its own day in the viewer's zone", () => {
    // 2026-10-07T03:30Z is Oct 6, 9:30 PM in Denver.
    expect(
      eventTimeEntryDate(
        { startTime: new Date("2026-10-07T03:30:00.000Z"), isAllDay: false },
        TZ,
        NOW
      )
    ).toBe("2026-10-06");
  });

  test("an all-day event uses its stored calendar date (no zone shift)", () => {
    expect(
      eventTimeEntryDate(
        { startTime: parseDateOnly("2026-10-06")!, isAllDay: true },
        TZ,
        NOW
      )
    ).toBe("2026-10-06");
  });

  test("a future event is clamped to the viewer's today", () => {
    expect(
      eventTimeEntryDate(
        { startTime: new Date("2026-11-02T17:00:00.000Z"), isAllDay: false },
        TZ,
        NOW
      )
    ).toBe("2026-10-14");
  });

  test("today's event stays today", () => {
    expect(
      eventTimeEntryDate(
        { startTime: new Date("2026-10-14T20:00:00.000Z"), isAllDay: false },
        TZ,
        NOW
      )
    ).toBe("2026-10-14");
  });
});

describe("formatHours", () => {
  test("shows quarter hours exactly (toFixed(1) said 0.3 and 0.8)", () => {
    expect(formatHours(0.25)).toBe("0.25");
    expect(formatHours(0.75)).toBe("0.75");
    expect(formatHours(1.25)).toBe("1.25");
  });

  test("trims trailing zeros", () => {
    expect(formatHours(2)).toBe("2");
    expect(formatHours(1.5)).toBe("1.5");
    expect(formatHours(0)).toBe("0");
  });

  test("absorbs float noise from summed entries", () => {
    expect(formatHours(0.1 + 0.2)).toBe("0.3");
    expect(formatHours(0.25 + 0.5 + 0.25)).toBe("1");
  });
});
