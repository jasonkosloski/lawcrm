import { describe, expect, test } from "vitest";
import { passwordFingerprint } from "./session-fingerprint";

describe("passwordFingerprint", () => {
  test("is stable for the same hash", () => {
    expect(passwordFingerprint("$argon2id$v=19$abc")).toBe(
      passwordFingerprint("$argon2id$v=19$abc")
    );
  });

  test("changes when the hash changes", () => {
    expect(passwordFingerprint("$argon2id$v=19$abc")).not.toBe(
      passwordFingerprint("$argon2id$v=19$abd")
    );
  });

  test("is 16 hex chars and never contains the hash itself", () => {
    const fp = passwordFingerprint("$argon2id$v=19$secret-hash");
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp).not.toContain("secret");
  });

  test("handles accounts with no password", () => {
    expect(passwordFingerprint(null)).toMatch(/^[0-9a-f]{16}$/);
  });
});
