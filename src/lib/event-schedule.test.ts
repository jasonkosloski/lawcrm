import { describe, expect, test } from "vitest";
import { parseDateOnly } from "@/lib/format-date";
import {
  dateOnly,
  nextHourInTz,
  normalizeVideoUrl,
  toScheduleInput,
  toScheduleWire,
  videoHref,
  withDefaultEnd,
  withDefaultStart,
} from "./event-schedule";

describe("toScheduleInput", () => {
  test("a timed boundary is the wall clock in the given zone", () => {
    const d = new Date("2026-07-06T15:00:00.000Z");
    expect(toScheduleInput(d, false, "America/Denver")).toBe("2026-07-06T09:00");
    expect(toScheduleInput(d, false, "Pacific/Auckland")).toBe(
      "2026-07-07T03:00"
    );
    expect(toScheduleInput(d, false, "UTC")).toBe("2026-07-06T15:00");
  });

  test("an all-day boundary is its own UTC date at T00:00, whatever the zone", () => {
    const d = parseDateOnly("2026-07-06")!;
    for (const tz of ["America/Denver", "Pacific/Auckland", "UTC"]) {
      expect(toScheduleInput(d, true, tz)).toBe("2026-07-06T00:00");
    }
  });

  test("a legacy all-day row at server-local midnight still reads as its day", () => {
    // Denver-laptop write: 06:00Z is still inside the UTC day.
    expect(
      toScheduleInput(new Date("2026-07-06T06:00:00.000Z"), true, "America/Denver")
    ).toBe("2026-07-06T00:00");
  });
});

describe("toScheduleWire", () => {
  test("all-day posts the date half, timed posts the value as is", () => {
    expect(toScheduleWire("2026-07-06T00:00", true)).toBe("2026-07-06");
    expect(toScheduleWire("2026-07-06T09:30", false)).toBe("2026-07-06T09:30");
  });
});

describe("all-day reseed", () => {
  test("midnight and bare dates become 9am / 10am; real times are kept", () => {
    expect(withDefaultStart("2026-07-06T00:00")).toBe("2026-07-06T09:00");
    expect(withDefaultStart("2026-07-06")).toBe("2026-07-06T09:00");
    expect(withDefaultEnd("2026-07-06T00:00")).toBe("2026-07-06T10:00");
    expect(withDefaultStart("2026-07-06T13:15")).toBe("2026-07-06T13:15");
    expect(withDefaultEnd("2026-07-06T14:45")).toBe("2026-07-06T14:45");
    expect(dateOnly("2026-07-06T13:15")).toBe("2026-07-06");
  });
});

describe("nextHourInTz", () => {
  // 2026-07-06T15:20Z: 09:20 in Denver, 03:20 (Jul 7) in Auckland.
  const now = new Date("2026-07-06T15:20:00.000Z");

  test("rounds up to the next top of the hour on the zone's wall clock", () => {
    expect(nextHourInTz("America/Denver", 0, now)).toBe("2026-07-06T10:00");
    expect(nextHourInTz("America/Denver", 1, now)).toBe("2026-07-06T11:00");
    expect(nextHourInTz("Pacific/Auckland", 0, now)).toBe("2026-07-07T04:00");
  });

  test("rolls over midnight", () => {
    const late = new Date("2026-07-07T05:40:00.000Z"); // 23:40 Denver Jul 6
    expect(nextHourInTz("America/Denver", 0, late)).toBe("2026-07-07T00:00");
    expect(nextHourInTz("America/Denver", 1, late)).toBe("2026-07-07T01:00");
  });
});

describe("normalizeVideoUrl", () => {
  test("empty stays empty", () => {
    expect(normalizeVideoUrl("")).toEqual({ ok: true, value: "" });
    expect(normalizeVideoUrl("   ")).toEqual({ ok: true, value: "" });
  });

  test("scheme-less invite links get https", () => {
    expect(normalizeVideoUrl(" zoom.us/j/8123 ")).toEqual({
      ok: true,
      value: "https://zoom.us/j/8123",
    });
    expect(normalizeVideoUrl("us02web.zoom.us:8443/j/1")).toEqual({
      ok: true,
      value: "https://us02web.zoom.us:8443/j/1",
    });
  });

  test("http(s) links pass through", () => {
    expect(normalizeVideoUrl("https://meet.google.com/abc-defg-hij")).toEqual({
      ok: true,
      value: "https://meet.google.com/abc-defg-hij",
    });
    expect(normalizeVideoUrl("http://example.com/x").ok).toBe(true);
  });

  test("other schemes and non-links are rejected", () => {
    for (const bad of [
      "javascript:alert(1)",
      "mailto:a@b.co",
      "ftp://files.example.com/x",
      "data:text/html,hi",
      "not a url",
      "ask front desk",
    ]) {
      expect(normalizeVideoUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("videoHref", () => {
  test("returns a usable href or null for legacy free text", () => {
    expect(videoHref("https://zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(videoHref("zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(videoHref("")).toBeNull();
    expect(videoHref("call the office")).toBeNull();
    expect(videoHref("javascript:alert(1)")).toBeNull();
  });
});
