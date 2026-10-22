import { describe, expect, test } from "vitest";
import { parseDateOnly } from "@/lib/format-date";
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
