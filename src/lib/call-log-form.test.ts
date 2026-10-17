/** Unit tests for the call-log form constants + helpers. */

import { describe, expect, it } from "vitest";
import {
  CALL_DIRECTIONS,
  CALL_DIRECTION_LABELS,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  asCallOutcome,
  durationSecToMinutesInput,
  formatCallDuration,
  isManualCallLog,
  isMissedCall,
  parseCallOccurredAt,
} from "./call-log-form";
import { toWallClockInput } from "./format-date";

describe("formatCallDuration", () => {
  it("returns null for missing / zero / negative durations", () => {
    expect(formatCallDuration(null)).toBeNull();
    expect(formatCallDuration(0)).toBeNull();
    expect(formatCallDuration(-60)).toBeNull();
  });

  it("formats sub-hour durations as minutes", () => {
    expect(formatCallDuration(60)).toBe("1m");
    expect(formatCallDuration(45 * 60)).toBe("45m");
  });

  it("formats exact hours without a minutes part", () => {
    expect(formatCallDuration(3600)).toBe("1h");
    expect(formatCallDuration(7200)).toBe("2h");
  });

  it("formats mixed hours + minutes", () => {
    expect(formatCallDuration(65 * 60)).toBe("1h 5m");
  });

  it("shows sub-minute calls in seconds, never 0m", () => {
    expect(formatCallDuration(1)).toBe("1s");
    expect(formatCallDuration(20)).toBe("20s");
    expect(formatCallDuration(29)).toBe("29s");
    expect(formatCallDuration(59)).toBe("59s");
  });

  it("rounds seconds to the nearest minute", () => {
    expect(formatCallDuration(90)).toBe("2m");
    expect(formatCallDuration(89)).toBe("1m");
  });
});

describe("option constants", () => {
  it("every direction and outcome has a label", () => {
    for (const d of CALL_DIRECTIONS) {
      expect(CALL_DIRECTION_LABELS[d]).toBeTruthy();
    }
    for (const o of CALL_OUTCOMES) {
      expect(CALL_OUTCOME_LABELS[o]).toBeTruthy();
    }
  });
});

describe("isManualCallLog (edit/delete mutability gate)", () => {
  it("manual-<uuid> ids are manual", () => {
    expect(isManualCallLog("manual-123e4567")).toBe(true);
  });

  it("provider event ids are not", () => {
    expect(isManualCallLog("quo-evt-99")).toBe(false);
    expect(isManualCallLog("")).toBe(false);
    // Prefix must be at the start, not merely present.
    expect(isManualCallLog("quo-manual-99")).toBe(false);
  });
});

describe("asCallOutcome (edit prefill)", () => {
  it("passes through valid manual outcomes", () => {
    expect(asCallOutcome("answered")).toBe("answered");
    expect(asCallOutcome("missed")).toBe("missed");
    expect(asCallOutcome("no_answer")).toBe("no_answer");
  });

  it("falls back to answered for provider-only / null statuses", () => {
    expect(asCallOutcome("busy")).toBe("answered");
    expect(asCallOutcome(null)).toBe("answered");
  });
});

describe("parseCallOccurredAt (composer value -> instant, user zone)", () => {
  it("reads the wall-clock value in the USER's zone, not the process zone", () => {
    // 14:30 on Jun 10 in Denver (MDT, UTC-6) is 20:30Z - whatever the
    // zone this test process runs in (the suite runs in both
    // America/Denver and UTC).
    expect(
      parseCallOccurredAt("2026-06-10T14:30", "America/Denver")?.toISOString()
    ).toBe("2026-06-10T20:30:00.000Z");
    expect(
      parseCallOccurredAt("2026-06-10T14:30", "UTC")?.toISOString()
    ).toBe("2026-06-10T14:30:00.000Z");
    expect(
      parseCallOccurredAt("2026-01-10T14:30", "America/Denver")?.toISOString()
    ).toBe("2026-01-10T21:30:00.000Z"); // MST, UTC-7
  });

  it("round-trips through the edit prefill without drifting", () => {
    // The old behaviour re-read the browser-local prefill as server
    // time, shifting the call by the zone offset on every save.
    const tz = "America/Denver";
    let instant = parseCallOccurredAt("2026-06-10T14:30", tz)!;
    for (let i = 0; i < 3; i++) {
      instant = parseCallOccurredAt(toWallClockInput(instant, tz), tz)!;
    }
    expect(instant.toISOString()).toBe("2026-06-10T20:30:00.000Z");
  });

  it("pins a date-only value to midnight of that day in the user's zone", () => {
    expect(
      parseCallOccurredAt("2026-06-10", "America/Denver")?.toISOString()
    ).toBe("2026-06-10T06:00:00.000Z");
    expect(parseCallOccurredAt("2026-06-10", "UTC")?.toISOString()).toBe(
      "2026-06-10T00:00:00.000Z"
    );
  });

  it("returns null for malformed or impossible values", () => {
    expect(parseCallOccurredAt("not-a-date", "UTC")).toBeNull();
    expect(parseCallOccurredAt("2026-02-30", "UTC")).toBeNull();
    expect(parseCallOccurredAt("2026-06-10T25:00", "UTC")).toBeNull();
    expect(parseCallOccurredAt("", "UTC")).toBeNull();
  });
});

describe("isMissedCall", () => {
  it("flags only inbound calls that rang out or were declined", () => {
    expect(isMissedCall("inbound", "missed")).toBe(true);
    expect(isMissedCall("inbound", "no_answer")).toBe(true);
    expect(isMissedCall("inbound", "declined")).toBe(true);
    expect(isMissedCall("inbound", "answered")).toBe(false);
    expect(isMissedCall("inbound", "busy")).toBe(false);
    expect(isMissedCall("inbound", "failed")).toBe(false);
  });

  it("an outbound unanswered attempt is not a missed call", () => {
    expect(isMissedCall("outbound", "no_answer")).toBe(false);
    expect(isMissedCall("outbound", "missed")).toBe(false);
  });

  it("is false without a direction or status", () => {
    expect(isMissedCall(null, "missed")).toBe(false);
    expect(isMissedCall("inbound", null)).toBe(false);
  });
});

describe("durationSecToMinutesInput (edit prefill)", () => {
  it("null / zero → empty input (missed calls)", () => {
    expect(durationSecToMinutesInput(null)).toBe("");
    expect(durationSecToMinutesInput(0)).toBe("");
  });

  it("converts seconds to a whole-minutes string, rounding", () => {
    expect(durationSecToMinutesInput(300)).toBe("5");
    expect(durationSecToMinutesInput(90)).toBe("2");
  });
});
