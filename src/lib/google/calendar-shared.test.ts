import { describe, expect, test } from "vitest";
import {
  CALENDAR_EVENTS_SCOPE,
  LAWCRM_MARKER_KEY,
  eventToGoogleResource,
  googleEventToCrmFields,
  hasCalendarScope,
  lawcrmIdOf,
} from "./calendar-shared";

describe("hasCalendarScope", () => {
  test("finds the scope in a space-separated grant list", () => {
    expect(
      hasCalendarScope(
        `openid email https://www.googleapis.com/auth/gmail.modify ${CALENDAR_EVENTS_SCOPE}`
      )
    ).toBe(true);
  });
  test("false for null, empty, and gmail-only grants", () => {
    expect(hasCalendarScope(null)).toBe(false);
    expect(hasCalendarScope("")).toBe(false);
    expect(
      hasCalendarScope("openid https://www.googleapis.com/auth/gmail.modify")
    ).toBe(false);
  });
  test("no prefix-matching — the broader calendar scope is a different string", () => {
    expect(
      hasCalendarScope("https://www.googleapis.com/auth/calendar")
    ).toBe(false);
  });
});

describe("eventToGoogleResource", () => {
  const base = {
    id: "evt1",
    title: "Deposition — Officer Reyes",
    description: "Bring exhibits 4–9",
    location: "200 W Colfax",
    startTime: new Date("2026-08-10T15:00:00.000Z"),
    endTime: new Date("2026-08-10T17:00:00.000Z"),
    isAllDay: false,
    zoomUrl: null,
  };

  test("timed event maps to dateTime + carries the echo marker", () => {
    const g = eventToGoogleResource(base);
    expect(g.summary).toBe(base.title);
    expect(g.start).toEqual({ dateTime: "2026-08-10T15:00:00.000Z" });
    expect(g.end).toEqual({ dateTime: "2026-08-10T17:00:00.000Z" });
    expect(g.extendedProperties?.private?.[LAWCRM_MARKER_KEY]).toBe("evt1");
  });

  test("all-day event uses date fields with EXCLUSIVE end (+1 day)", () => {
    const g = eventToGoogleResource({
      ...base,
      // Local midnights per the repo's date-only convention.
      startTime: new Date(2026, 7, 10),
      endTime: new Date(2026, 7, 10),
      isAllDay: true,
    });
    expect(g.start).toEqual({ date: "2026-08-10" });
    expect(g.end).toEqual({ date: "2026-08-11" });
  });

  test("zoom URL folds into the description; empty description omitted", () => {
    const g = eventToGoogleResource({
      ...base,
      description: null,
      zoomUrl: "https://zoom.us/j/123",
    });
    expect(g.description).toBe("Zoom: https://zoom.us/j/123");
    const g2 = eventToGoogleResource({ ...base, description: null });
    expect(g2.description).toBeUndefined();
  });

  test("attendees never appear in the resource (invite-email hazard)", () => {
    const g = eventToGoogleResource(base) as Record<string, unknown>;
    expect("attendees" in g).toBe(false);
  });
});

describe("googleEventToCrmFields", () => {
  test("timed round-trip", () => {
    const fields = googleEventToCrmFields({
      summary: "Hearing",
      start: { dateTime: "2026-08-10T15:00:00Z" },
      end: { dateTime: "2026-08-10T16:00:00Z" },
    })!;
    expect(fields.title).toBe("Hearing");
    expect(fields.isAllDay).toBe(false);
    expect(fields.startTime.toISOString()).toBe("2026-08-10T15:00:00.000Z");
  });

  test("all-day exclusive end maps back to inclusive local-midnight end", () => {
    const fields = googleEventToCrmFields({
      summary: "CLE conference",
      start: { date: "2026-08-10" },
      end: { date: "2026-08-12" }, // exclusive → covers 10th + 11th
    })!;
    expect(fields.isAllDay).toBe(true);
    expect(fields.startTime.getTime()).toBe(new Date(2026, 7, 10).getTime());
    expect(fields.endTime.getTime()).toBe(new Date(2026, 7, 11).getTime());
  });

  test("single all-day day never produces end < start", () => {
    const fields = googleEventToCrmFields({
      summary: "x",
      start: { date: "2026-08-10" },
      end: { date: "2026-08-10" }, // malformed (Google always sends +1) — clamp
    })!;
    expect(fields.endTime.getTime()).toBe(fields.startTime.getTime());
  });

  test("summary-less events get a placeholder title; missing times → null", () => {
    expect(
      googleEventToCrmFields({
        start: { dateTime: "2026-08-10T15:00:00Z" },
        end: { dateTime: "2026-08-10T16:00:00Z" },
      })!.title
    ).toBe("(no title)");
    expect(googleEventToCrmFields({ summary: "x" })).toBeNull();
    expect(
      googleEventToCrmFields({
        summary: "x",
        start: { dateTime: "not a date" },
        end: { dateTime: "2026-08-10T16:00:00Z" },
      })
    ).toBeNull();
  });
});

describe("lawcrmIdOf", () => {
  test("reads the marker; null when absent", () => {
    expect(
      lawcrmIdOf({
        extendedProperties: { private: { [LAWCRM_MARKER_KEY]: "evt9" } },
      })
    ).toBe("evt9");
    expect(lawcrmIdOf({})).toBeNull();
    expect(lawcrmIdOf({ extendedProperties: { private: {} } })).toBeNull();
  });
});
