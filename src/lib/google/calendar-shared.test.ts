import { describe, expect, test } from "vitest";
import {
  CALENDAR_EVENTS_SCOPE,
  LAWCRM_MARKER_KEY,
  eventToGoogleResource,
  googleEventIdFor,
  googleEventToCrmFields,
  hasCalendarScope,
  lawcrmIdOf,
  stripZoomLine,
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
      // UTC midnights per the date-only convention (ADR-012).
      startTime: new Date("2026-08-10T00:00:00.000Z"),
      endTime: new Date("2026-08-10T00:00:00.000Z"),
      isAllDay: true,
    });
    expect(g.start).toEqual({ date: "2026-08-10" });
    expect(g.end).toEqual({ date: "2026-08-11" });
  });

  test("all-day push reads the stored UTC day on any server zone, incl. legacy Denver-midnight rows and DST days (F695/F941)", () => {
    // Fall-back day (25 h in Denver): local-getter / +24h math gave
    // end.date == start.date (a zero-length event Google rejects).
    const fallBack = eventToGoogleResource({
      ...base,
      startTime: new Date("2026-11-01T00:00:00.000Z"),
      endTime: new Date("2026-11-01T00:00:00.000Z"),
      isAllDay: true,
    });
    expect(fallBack.start).toEqual({ date: "2026-11-01" });
    expect(fallBack.end).toEqual({ date: "2026-11-02" });

    // Legacy row written by the old local-midnight parser on a Denver laptop: local
    // midnight = 06:00Z/07:00Z, still the right UTC day.
    const legacy = eventToGoogleResource({
      ...base,
      startTime: new Date("2026-03-08T07:00:00.000Z"),
      endTime: new Date("2026-03-09T06:00:00.000Z"),
      isAllDay: true,
    });
    expect(legacy.start).toEqual({ date: "2026-03-08" });
    expect(legacy.end).toEqual({ date: "2026-03-10" });

    // Month / year rollover.
    const rollover = eventToGoogleResource({
      ...base,
      startTime: new Date("2026-12-31T00:00:00.000Z"),
      endTime: new Date("2026-12-31T00:00:00.000Z"),
      isAllDay: true,
    });
    expect(rollover.end).toEqual({ date: "2027-01-01" });
  });

  test("zoom URL folds into the description; empty description/location are sent as '' so a PATCH clears them", () => {
    const g = eventToGoogleResource({
      ...base,
      description: null,
      zoomUrl: "https://zoom.us/j/123",
    });
    expect(g.description).toBe("Zoom: https://zoom.us/j/123");
    const g2 = eventToGoogleResource({
      ...base,
      description: null,
      location: null,
    });
    expect(g2.description).toBe("");
    expect(g2.location).toBe("");
    // JSON.stringify keeps "" (it would drop undefined) — the PATCH
    // body actually carries the clear.
    const body = JSON.parse(JSON.stringify(g2));
    expect(body.description).toBe("");
    expect(body.location).toBe("");
  });

  test("zoom line is not appended twice to an already-polluted description", () => {
    const g = eventToGoogleResource({
      ...base,
      description: "Bring exhibits\n\nZoom: https://zoom.us/j/1",
      zoomUrl: "https://zoom.us/j/1",
    });
    expect(g.description).toBe("Bring exhibits\n\nZoom: https://zoom.us/j/1");
  });

  test("push -> pull round-trip leaves the CRM description unchanged", () => {
    const crm = {
      ...base,
      description: "Bring exhibits",
      zoomUrl: "https://zoom.us/j/1",
    };
    const echoed = googleEventToCrmFields({
      ...eventToGoogleResource(crm),
    })!;
    expect(stripZoomLine(echoed.description, crm.zoomUrl)).toBe(
      "Bring exhibits"
    );
    // Zoom-only description round-trips to null.
    const zoomOnly = googleEventToCrmFields({
      ...eventToGoogleResource({ ...crm, description: null }),
    })!;
    expect(stripZoomLine(zoomOnly.description, crm.zoomUrl)).toBeNull();
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
    expect(fields.startTime.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(fields.endTime.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  test("all-day pull across DST transitions stays on exact UTC-midnight days (F695/F941)", () => {
    // Spring-forward: a 2-day event 03-08..03-09 (exclusive end 03-10).
    const spring = googleEventToCrmFields({
      summary: "x",
      start: { date: "2026-03-08" },
      end: { date: "2026-03-10" },
    })!;
    expect(spring.startTime.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(spring.endTime.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    // Fall-back day, single day.
    const fall = googleEventToCrmFields({
      summary: "x",
      start: { date: "2026-11-01" },
      end: { date: "2026-11-02" },
    })!;
    expect(fall.startTime.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(fall.endTime.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("all-day push -> pull round-trips the same days", () => {
    const pushed = eventToGoogleResource({
      id: "e",
      title: "t",
      description: null,
      location: null,
      startTime: new Date("2026-11-01T00:00:00.000Z"),
      endTime: new Date("2026-11-03T00:00:00.000Z"),
      isAllDay: true,
    });
    const back = googleEventToCrmFields(pushed)!;
    expect(back.startTime.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(back.endTime.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  test("a malformed all-day date makes the resource unmappable instead of an Invalid Date", () => {
    expect(
      googleEventToCrmFields({
        summary: "x",
        start: { date: "2026-02-31" },
        end: { date: "2026-03-01" },
      })
    ).toBeNull();
    expect(
      googleEventToCrmFields({
        summary: "x",
        start: { date: "garbage" },
        end: { date: "2026-03-01" },
      })
    ).toBeNull();
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

describe("googleEventIdFor", () => {
  test("is deterministic, lowercase base32hex (a-v0-9) and 5-1024 chars", () => {
    const id = googleEventIdFor("cmgx7k2a90000abcdwxyz12345");
    expect(id).toBe(googleEventIdFor("cmgx7k2a90000abcdwxyz12345"));
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(googleEventIdFor("a")).toMatch(/^[a-v0-9]{5,}$/);
  });
  test("distinct CRM ids map to distinct Google ids (incl. the w-z characters base32hex lacks)", () => {
    expect(googleEventIdFor("abcxyz")).not.toBe(googleEventIdFor("abcxyw"));
  });
  test("matches the RFC 4648 base32hex vector for 'foobar'", () => {
    // RFC 4648 test vector: BASE32-HEX("foobar") = CPNMUOJ1E8======
    expect(googleEventIdFor("foobar")).toBe("cpnmuoj1e8");
  });
});

describe("stripZoomLine", () => {
  const url = "https://zoom.us/j/9";
  test("strips every stacked trailing copy and leaves other text alone", () => {
    expect(stripZoomLine(`Notes\n\nZoom: ${url}\n\nZoom: ${url}`, url)).toBe(
      "Notes"
    );
    expect(stripZoomLine("Notes", url)).toBe("Notes");
    expect(stripZoomLine(`Zoom: ${url}`, url)).toBeNull();
    expect(stripZoomLine(`Notes\n\nZoom: ${url}`, null)).toBe(
      `Notes\n\nZoom: ${url}`
    );
    expect(stripZoomLine(null, url)).toBeNull();
  });
});

describe("googleEventToCrmFields — hostile text", () => {
  test("NUL bytes are stripped from title/description/location", () => {
    const f = googleEventToCrmFields({
      summary: "Hear\u0000ing",
      description: "d\u0000esc",
      location: "\u0000",
      start: { dateTime: "2026-08-10T15:00:00Z" },
      end: { dateTime: "2026-08-10T16:00:00Z" },
    })!;
    expect(f.title).toBe("Hearing");
    expect(f.description).toBe("desc");
    expect(f.location).toBeNull();
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
