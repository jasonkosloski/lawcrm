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
  toDateTimeLocal,
} from "./call-log-form";

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

describe("toDateTimeLocal (edit prefill / composer default)", () => {
  it("renders a datetime-local value with zero padding", () => {
    expect(toDateTimeLocal(new Date(2026, 5, 10, 14, 30))).toBe(
      "2026-06-10T14:30"
    );
    expect(toDateTimeLocal(new Date(2026, 0, 3, 9, 5))).toBe(
      "2026-01-03T09:05"
    );
  });

  it("round-trips through the action's `new Date(...)` parse", () => {
    const d = new Date(2026, 6, 4, 23, 59);
    expect(new Date(toDateTimeLocal(d)).getTime()).toBe(d.getTime());
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
