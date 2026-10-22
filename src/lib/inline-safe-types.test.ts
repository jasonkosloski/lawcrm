/**
 * Pins the inline-safe content-type allowlist. Both file-serving
 * routes (document + email-attachment downloads) consult it before
 * rendering attacker-controlled bytes inline on our origin, so adding
 * an executable type (HTML, SVG, XML, JS...) is a stored-XSS hole.
 * The exact-set assertion makes any addition a deliberate, reviewed
 * change to this test.
 */

import { describe, expect, test } from "vitest";
import { INLINE_SAFE_TYPES, isInlineSafeType } from "./inline-safe-types";

describe("INLINE_SAFE_TYPES", () => {
  test("is exactly the reviewed passive-render set", () => {
    expect([...INLINE_SAFE_TYPES].sort()).toEqual(
      [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "audio/mpeg",
        "audio/mp4",
        "audio/wav",
        "audio/webm",
        "audio/ogg",
        "text/plain",
        "text/csv",
      ].sort(),
    );
  });
});

describe("isInlineSafeType", () => {
  test.each([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/xml",
    "text/xml",
    "application/javascript",
    "text/javascript",
    "application/json",
    "application/octet-stream",
  ])("%s is never inline-safe", (type) => {
    expect(isInlineSafeType(type)).toBe(false);
  });

  test("allowed types pass", () => {
    expect(isInlineSafeType("application/pdf")).toBe(true);
    expect(isInlineSafeType("image/png")).toBe(true);
    expect(isInlineSafeType("text/plain")).toBe(true);
  });

  test("compares on the bare media type: parameters and case are normalized", () => {
    expect(isInlineSafeType("TEXT/PLAIN; charset=utf-8")).toBe(true);
    expect(isInlineSafeType(" Text/HTML ; charset=utf-8")).toBe(false);
    // Parameter smuggling: the allowed type only in the parameter.
    expect(isInlineSafeType("text/html; x=text/plain")).toBe(false);
  });

  test("null / empty are attachment-only", () => {
    expect(isInlineSafeType(null)).toBe(false);
    expect(isInlineSafeType("")).toBe(false);
  });
});
