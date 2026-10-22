import { describe, expect, test } from "vitest";
import { isSendableStatus, SENDABLE_EMAIL_STATUSES } from "./email-send-status";

describe("isSendableStatus", () => {
  test.each([
    ["connected", true],
    ["syncing", true],
    ["error", false],
    ["disconnected", false],
    ["", false],
  ])("%j -> %s", (status, expected) => {
    expect(isSendableStatus(status)).toBe(expected);
  });

  test("the list and the predicate agree", () => {
    for (const s of SENDABLE_EMAIL_STATUSES) {
      expect(isSendableStatus(s)).toBe(true);
    }
  });
});
