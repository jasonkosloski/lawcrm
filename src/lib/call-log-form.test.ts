/** Unit tests for the call-log form constants + helpers. */

import { describe, expect, it } from "vitest";
import {
  CALL_DIRECTIONS,
  CALL_DIRECTION_LABELS,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  formatCallDuration,
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
