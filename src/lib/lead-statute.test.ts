import { describe, expect, test } from "vitest";
import { describeStatuteRemaining, STATUTE_WARN_DAYS } from "./lead-statute";

describe("describeStatuteRemaining", () => {
  test("plenty of time is not a warning", () => {
    expect(describeStatuteRemaining(340)).toEqual({
      short: "340d",
      long: "340 days",
      warn: false,
      expired: false,
    });
  });

  test("warns at the threshold and below, not above it", () => {
    expect(describeStatuteRemaining(STATUTE_WARN_DAYS + 1).warn).toBe(false);
    expect(describeStatuteRemaining(STATUTE_WARN_DAYS).warn).toBe(true);
    expect(describeStatuteRemaining(0).warn).toBe(true);
  });

  test("a run window reads as past, never as a negative countdown", () => {
    const d = describeStatuteRemaining(-5);
    expect(d.short).toBe("5d over");
    expect(d.long).toBe("5 days past");
    expect(d.warn).toBe(true);
    expect(d.expired).toBe(true);
    expect(describeStatuteRemaining(-1).long).toBe("1 day past");
  });
});
