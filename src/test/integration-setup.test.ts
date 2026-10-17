import { describe, expect, it } from "vitest";
import { shouldHoldRunLock } from "./integration-setup";

describe("shouldHoldRunLock", () => {
  it("holds the lock for one-shot runs", () => {
    expect(shouldHoldRunLock({ watch: false, ui: false })).toBe(true);
    expect(shouldHoldRunLock({})).toBe(true);
  });

  it("skips the lock for watch and UI sessions so commits are not blocked", () => {
    expect(shouldHoldRunLock({ watch: true, ui: false })).toBe(false);
    expect(shouldHoldRunLock({ watch: false, ui: true })).toBe(false);
  });
});
