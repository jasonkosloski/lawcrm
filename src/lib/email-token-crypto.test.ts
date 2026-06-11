/**
 * Unit tests for the OAuth-token crypto primitives.
 *
 * These manipulate EMAIL_TOKEN_KEY directly to probe key-handling
 * edge cases, so they save and restore the env around each test —
 * the suite-wide default is set in src/test/setup.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "./email-token-crypto";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.EMAIL_TOKEN_KEY;
  process.env.EMAIL_TOKEN_KEY = KEY_A;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.EMAIL_TOKEN_KEY;
  else process.env.EMAIL_TOKEN_KEY = savedKey;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    const token = "ya29.a0AfH6SMBx-fake-access-token_with-dashes_and.dots";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("round-trips unicode + empty-ish content", () => {
    expect(decryptToken(encryptToken("héllo→世界"))).toBe("héllo→世界");
    expect(decryptToken(encryptToken(""))).toBe("");
  });

  it("produces a fresh IV per call — same input, different ciphertext", () => {
    const token = "refresh-1//abc";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("emits the v1 wire format", () => {
    expect(encryptToken("x")).toMatch(/^v1:[^:]+:[^:]+:/);
  });

  it("rejects a tampered ciphertext", () => {
    const stored = encryptToken("secret");
    const parts = stored.split(":");
    // Flip the ciphertext segment; auth tag must catch it.
    parts[3] = Buffer.from("tampered!").toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow(/authentication failed/);
  });

  it("rejects decryption under a different key", () => {
    const stored = encryptToken("secret");
    process.env.EMAIL_TOKEN_KEY = KEY_B;
    expect(() => decryptToken(stored)).toThrow(/authentication failed/);
  });

  it("rejects plaintext input to decryptToken", () => {
    expect(() => decryptToken("just-a-plain-token")).toThrow(
      /not in the v1 encrypted format/
    );
  });

  it("fails loudly when the key is missing", () => {
    delete process.env.EMAIL_TOKEN_KEY;
    expect(() => encryptToken("x")).toThrow(/EMAIL_TOKEN_KEY is not set/);
  });

  it("fails loudly when the key is the wrong length", () => {
    process.env.EMAIL_TOKEN_KEY = Buffer.alloc(16, 3).toString("base64");
    expect(() => encryptToken("x")).toThrow(/must be 32 bytes/);
  });
});

describe("isEncryptedToken", () => {
  it("recognizes encrypted output", () => {
    expect(isEncryptedToken(encryptToken("x"))).toBe(true);
  });

  it("rejects plaintext, including colon-bearing tokens", () => {
    expect(isEncryptedToken("plain-token")).toBe(false);
    expect(isEncryptedToken("v2:future:format:x")).toBe(false);
    expect(isEncryptedToken("v1:not enough segments")).toBe(false);
    expect(isEncryptedToken("")).toBe(false);
  });
});
