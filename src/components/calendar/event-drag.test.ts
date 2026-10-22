/**
 * allDayDropSchedule - what a chip dropped on an all-day cell becomes.
 * All-day bounds are date-only (ADR-012): UTC midnight of the day
 * keys regardless of the browser zone, span preserved.
 */

import { describe, expect, test } from "vitest";
import { allDayDropSchedule } from "./event-drag";

const iso = (s: string) => new Date(s).toISOString();

describe("allDayDropSchedule", () => {
  test("a multi-day all-day event keeps its span when dropped elsewhere", () => {
    const r = allDayDropSchedule(
      {
        isAllDay: true,
        startTimeIso: iso("2026-04-13T00:00:00Z"), // Mon
        endTimeIso: iso("2026-04-15T00:00:00Z"), // Wed
      },
      "2026-04-16",
    );
    expect(r?.isAllDay).toBe(true);
    expect(r?.start.toISOString()).toBe("2026-04-16T00:00:00.000Z");
    expect(r?.end.toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  test("dropping on the event's own first day is a no-op", () => {
    expect(
      allDayDropSchedule(
        {
          isAllDay: true,
          startTimeIso: iso("2026-04-13T00:00:00Z"),
          endTimeIso: iso("2026-04-15T00:00:00Z"),
        },
        "2026-04-13",
      ),
    ).toBeNull();
  });

  test("a timed event collapses to a single all-day date, at UTC midnight", () => {
    const r = allDayDropSchedule(
      {
        isAllDay: false,
        startTimeIso: iso("2026-04-13T15:00:00Z"),
        endTimeIso: iso("2026-04-13T16:00:00Z"),
      },
      "2026-04-14",
    );
    expect(r?.start.toISOString()).toBe("2026-04-14T00:00:00.000Z");
    expect(r?.end.toISOString()).toBe("2026-04-14T00:00:00.000Z");
  });

  test("a timed event on the same date still becomes all-day (not a no-op)", () => {
    expect(
      allDayDropSchedule(
        {
          isAllDay: false,
          startTimeIso: iso("2026-04-13T15:00:00Z"),
          endTimeIso: iso("2026-04-13T16:00:00Z"),
        },
        "2026-04-13",
      ),
    ).not.toBeNull();
  });
});
