/**
 * Unit tests for the contact phone-list helpers.
 *
 * The invariants they encode (exactly one primary when any rows
 * exist; formatting-insensitive dedupe) back both the phone-manager
 * UI and the merge action, so pin them here where they're cheap.
 */

import { describe, expect, test } from "vitest";
import { normalizeContactPhones, phoneDedupeKey } from "@/lib/contact-form";

describe("normalizeContactPhones", () => {
  test("empty list stays empty", () => {
    expect(normalizeContactPhones([])).toEqual([]);
  });

  test("drops entries with an empty / whitespace number", () => {
    const out = normalizeContactPhones([
      { label: "Cell", number: "   ", isPrimary: true },
      { label: "Office", number: "303-555-0101", isPrimary: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].number).toBe("303-555-0101");
  });

  test("trims labels and numbers", () => {
    const out = normalizeContactPhones([
      { label: "  Cell ", number: " 303-555-0101 ", isPrimary: true },
    ]);
    expect(out[0]).toEqual({
      label: "Cell",
      number: "303-555-0101",
      isPrimary: true,
    });
  });

  test("promotes the first entry when none is marked primary", () => {
    const out = normalizeContactPhones([
      { label: "", number: "111", isPrimary: false },
      { label: "", number: "222", isPrimary: false },
    ]);
    expect(out.map((e) => e.isPrimary)).toEqual([true, false]);
  });

  test("first marked primary wins; extra primaries are cleared", () => {
    const out = normalizeContactPhones([
      { label: "", number: "111", isPrimary: false },
      { label: "", number: "222", isPrimary: true },
      { label: "", number: "333", isPrimary: true },
    ]);
    expect(out.map((e) => e.isPrimary)).toEqual([false, true, false]);
  });

  test("dropping an empty-number primary re-promotes among survivors", () => {
    const out = normalizeContactPhones([
      { label: "Cell", number: "", isPrimary: true },
      { label: "Office", number: "222", isPrimary: false },
    ]);
    expect(out).toEqual([
      { label: "Office", number: "222", isPrimary: true },
    ]);
  });
});

describe("phoneDedupeKey", () => {
  test("is formatting-insensitive for US-style numbers", () => {
    expect(phoneDedupeKey("(303) 555-0101")).toBe(
      phoneDedupeKey("303.555.0101")
    );
  });

  test("different numbers get different keys", () => {
    expect(phoneDedupeKey("303-555-0101")).not.toBe(
      phoneDedupeKey("303-555-0102")
    );
  });

  test("digit-free inputs fall back to the trimmed lowercase string", () => {
    expect(phoneDedupeKey(" Ask Reception ")).toBe(
      phoneDedupeKey("ask reception")
    );
    expect(phoneDedupeKey("ask reception")).toBe("ask reception");
  });
});
