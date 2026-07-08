/**
 * Unit tests for the media timestamp helpers — the one clock
 * notation shared by the flag composer (parse), the moments rail,
 * and the evidence review page (format).
 */

import { describe, expect, test } from "vitest";
import {
  MAX_MEDIA_SECONDS,
  formatMediaSpan,
  formatMediaTime,
  parseMediaTime,
} from "./media-time";

describe("formatMediaTime", () => {
  test("under a minute", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(7)).toBe("0:07");
    expect(formatMediaTime(59)).toBe("0:59");
  });

  test("minutes", () => {
    expect(formatMediaTime(60)).toBe("1:00");
    expect(formatMediaTime(75)).toBe("1:15");
    expect(formatMediaTime(3599)).toBe("59:59");
  });

  test("hours get the h:mm:ss form with padded minutes", () => {
    expect(formatMediaTime(3600)).toBe("1:00:00");
    expect(formatMediaTime(3723)).toBe("1:02:03");
    expect(formatMediaTime(7 * 3600 + 5 * 60 + 9)).toBe("7:05:09");
  });

  test("fractional seconds floor; junk clamps to 0:00", () => {
    expect(formatMediaTime(75.9)).toBe("1:15");
    expect(formatMediaTime(-3)).toBe("0:00");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
    expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("parseMediaTime", () => {
  test("mm:ss and zero-padded variants", () => {
    expect(parseMediaTime("1:15")).toBe(75);
    expect(parseMediaTime("01:15")).toBe(75);
    expect(parseMediaTime("0:00")).toBe(0);
    // Un-padded seconds tolerated — "1:5" reads as 1:05.
    expect(parseMediaTime("1:5")).toBe(65);
  });

  test("bare seconds and h:mm:ss", () => {
    expect(parseMediaTime("75")).toBe(75);
    expect(parseMediaTime("1:02:03")).toBe(3723);
  });

  test("whitespace is trimmed", () => {
    expect(parseMediaTime("  2:30 ")).toBe(150);
  });

  test("rejects invalid clock inputs", () => {
    expect(parseMediaTime("")).toBeNull();
    expect(parseMediaTime("  ")).toBeNull();
    expect(parseMediaTime("1:60")).toBeNull(); // seconds > 59
    expect(parseMediaTime("1:60:00")).toBeNull(); // minutes > 59 with hours
    expect(parseMediaTime("-1:00")).toBeNull();
    expect(parseMediaTime("1:15.5")).toBeNull(); // no decimals
    expect(parseMediaTime("1:2:3:4")).toBeNull(); // too many segments
    expect(parseMediaTime("abc")).toBeNull();
    expect(parseMediaTime("1:ab")).toBeNull();
  });

  test("caps at 24h", () => {
    expect(parseMediaTime("24:00:00")).toBe(MAX_MEDIA_SECONDS);
    expect(parseMediaTime("24:00:01")).toBeNull();
    expect(parseMediaTime(String(MAX_MEDIA_SECONDS + 1))).toBeNull();
  });

  test("round-trips format output", () => {
    for (const s of [0, 7, 59, 75, 3599, 3600, 3723, 86399]) {
      expect(parseMediaTime(formatMediaTime(s))).toBe(s);
    }
  });
});

describe("formatMediaSpan", () => {
  test("point moment renders start only", () => {
    expect(formatMediaSpan(75, null)).toBe("1:15");
    expect(formatMediaSpan(75, undefined)).toBe("1:15");
  });

  test("span renders start–end with an en dash", () => {
    expect(formatMediaSpan(42, 65)).toBe("0:42–1:05");
  });
});
