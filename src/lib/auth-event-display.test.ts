import { describe, expect, test } from "vitest";
import { describeAuthDetail, describeUserAgent } from "./auth-event-display";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("describeUserAgent", () => {
  test.each([
    [MAC_CHROME, "Chrome on macOS"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on Linux",
    ],
  ])("%s", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  test("unknown agent → null", () => {
    expect(describeUserAgent("curl/8.0")).toBeNull();
  });
});

describe("describeAuthDetail", () => {
  test("reason, IP and agent become plain words, agent first", () => {
    expect(
      describeAuthDetail(`revoked by admin — IP 203.0.113.9 · ${MAC_CHROME}`)
    ).toBe("Chrome on macOS · revoked by admin · IP 203.0.113.9");
  });

  test("webhook session ids and Clerk ids are dropped", () => {
    expect(describeAuthDetail("Session sess_2abc")).toBeNull();
    expect(
      describeAuthDetail("Clerk user user_9xyz: no matching member — IP ::1")
    ).toBe("IP ::1");
  });

  test("null / empty stay null", () => {
    expect(describeAuthDetail(null)).toBeNull();
    expect(describeAuthDetail("")).toBeNull();
  });
});
