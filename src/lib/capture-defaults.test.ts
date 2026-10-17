import { describe, expect, test } from "vitest";
import { nextHourInput, todayInput } from "./capture-defaults";

// 2026-10-16T02:20:00Z = Oct 15, 8:20 PM in Denver (MDT, UTC-6),
// but already Oct 16 in UTC.
const NOW = new Date("2026-10-16T02:20:00Z");

describe("todayInput", () => {
  test("is the viewer's calendar day, not the runtime's", () => {
    expect(todayInput("America/Denver", NOW)).toBe("2026-10-15");
    expect(todayInput("UTC", NOW)).toBe("2026-10-16");
  });
});

describe("nextHourInput", () => {
  test("rounds up to the next full hour in the profile zone", () => {
    expect(nextHourInput("America/Denver", 0, NOW)).toBe("2026-10-15T21:00");
    expect(nextHourInput("America/Denver", 1, NOW)).toBe("2026-10-15T22:00");
    expect(nextHourInput("UTC", 0, NOW)).toBe("2026-10-16T03:00");
  });

  test("on the hour goes to the following hour", () => {
    const onTheHour = new Date("2026-10-16T21:00:00Z"); // 3:00 PM MDT
    expect(nextHourInput("America/Denver", 0, onTheHour)).toBe(
      "2026-10-16T16:00"
    );
  });

  test("rolls over midnight", () => {
    const late = new Date("2026-10-16T05:30:00Z"); // 11:30 PM MDT Oct 15
    expect(nextHourInput("America/Denver", 0, late)).toBe("2026-10-16T00:00");
  });
});
