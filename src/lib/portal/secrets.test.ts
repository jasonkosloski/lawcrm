import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";

import { __resetHmacWarningForTests, hashSecret, hmacSecret } from "./secrets";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetHmacWarningForTests();
});

describe("hmacSecret", () => {
  test("is HMAC-SHA256 keyed with AUTH_SECRET, not a plain hash", () => {
    vi.stubEnv("AUTH_SECRET", "k1");
    const want = createHmac("sha256", "k1").update("jane@example.com").digest("hex");
    expect(hmacSecret("jane@example.com")).toBe(want);
    expect(hmacSecret("jane@example.com")).not.toBe(sha("jane@example.com"));
    expect(hmacSecret("jane@example.com")).not.toBe(hashSecret("jane@example.com"));
  });

  test("outside production with no AUTH_SECRET, uses a fixed dev key", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const a = hmacSecret("x");
    expect(a).not.toBe(sha("x"));
    expect(hmacSecret("x")).toBe(a);
  });

  test("in production with no AUTH_SECRET, falls back to sha256 and logs once", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(hmacSecret("x")).toBe(sha("x"));
    expect(hmacSecret("y")).toBe(sha("y"));
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toContain('"x"');
  });
});
