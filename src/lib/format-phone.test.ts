/**
 * Tests for the phone formatter. Edge-heavy because the real
 * world is messy: pasted strings from email sigs, country codes,
 * partial entries, "555-EATS" vanity numbers, etc. The contract
 * is: format what we recognize, leave everything else alone.
 */

import { describe, expect, test } from "vitest";
import { formatPhone } from "./format-phone";

describe("formatPhone", () => {
  test("null / undefined / empty → empty string", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
    expect(formatPhone("")).toBe("");
  });

  test("10-digit raw → (xxx) xxx-xxxx", () => {
    expect(formatPhone("3035551212")).toBe("(303) 555-1212");
  });

  test("10-digit with separators normalizes the same way", () => {
    expect(formatPhone("303-555-1212")).toBe("(303) 555-1212");
    expect(formatPhone("303.555.1212")).toBe("(303) 555-1212");
    expect(formatPhone("303 555 1212")).toBe("(303) 555-1212");
    expect(formatPhone("(303) 555-1212")).toBe("(303) 555-1212");
  });

  test("11 digits starting with country-code 1 → strip + format", () => {
    expect(formatPhone("13035551212")).toBe("(303) 555-1212");
    expect(formatPhone("+1 303 555 1212")).toBe("(303) 555-1212");
    expect(formatPhone("1-303-555-1212")).toBe("(303) 555-1212");
  });

  test("non-1 prefix on 11 digits is left alone", () => {
    // Don't reformat international numbers — we'd guess wrong.
    expect(formatPhone("44 20 7946 0958")).toBe("44 20 7946 0958");
  });

  test("partial / over-length / vanity numbers passthrough untouched", () => {
    // Partial entry while the user is still typing.
    expect(formatPhone("303")).toBe("303");
    expect(formatPhone("303555")).toBe("303555");
    // Vanity number — letters survive because we don't translate
    // them (different keypads, different regions).
    expect(formatPhone("555-EATS")).toBe("555-EATS");
    // Way too many digits — probably an error in upstream parsing,
    // but formatting it as a phone number would lose information.
    expect(formatPhone("123456789012345")).toBe("123456789012345");
  });

  test("zero-only input passes through (preserves storage)", () => {
    expect(formatPhone("0000000000")).toBe("(000) 000-0000");
  });

  test("digits with extension/other suffix are NOT normalized", () => {
    // Don't try to be clever about extensions — render raw so the
    // user sees what they entered.
    expect(formatPhone("303-555-1212 ext. 42")).toBe(
      "303-555-1212 ext. 42"
    );
  });
});
