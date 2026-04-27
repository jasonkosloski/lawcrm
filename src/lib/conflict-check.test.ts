/**
 * Tests for conflict-check pure helpers.
 *
 * The matcher itself runs DB queries; that's covered in the
 * action-level integration tests later. This file pins down the
 * normalization + severity-rollup helpers, which are pure.
 */

import { describe, expect, test } from "vitest";
import {
  normalize,
  summarizeMatchSeverity,
  type ConflictMatch,
} from "./conflict-check";

describe("normalize", () => {
  test("lowercases", () => {
    expect(normalize("Jane Doe")).toBe("jane doe");
    expect(normalize("JANE DOE")).toBe("jane doe");
  });

  test("trims surrounding whitespace", () => {
    expect(normalize("  jane  ")).toBe("jane");
  });

  test("collapses internal whitespace runs", () => {
    expect(normalize("Jane    Doe")).toBe("jane doe");
    expect(normalize("Jane\t\nDoe")).toBe("jane doe");
  });

  test("null / undefined / empty → empty string", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
  });
});

describe("summarizeMatchSeverity", () => {
  const matchOf = (severity: "warn" | "conflict"): ConflictMatch => ({
    kind: "contact_name",
    severity,
    matchedField: "name",
    description: "test",
  });

  test("empty list → clear", () => {
    expect(summarizeMatchSeverity([])).toBe("clear");
  });

  test("one warn → warn", () => {
    expect(summarizeMatchSeverity([matchOf("warn")])).toBe("warn");
  });

  test("warn + warn → warn", () => {
    expect(
      summarizeMatchSeverity([matchOf("warn"), matchOf("warn")])
    ).toBe("warn");
  });

  test("any conflict → conflict (even mixed with warns)", () => {
    expect(
      summarizeMatchSeverity([matchOf("warn"), matchOf("conflict")])
    ).toBe("conflict");
  });

  test("only conflict → conflict", () => {
    expect(summarizeMatchSeverity([matchOf("conflict")])).toBe("conflict");
  });
});
