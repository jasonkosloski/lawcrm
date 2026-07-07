/**
 * Tests for the palette scoping-prefix parser + value tagging.
 *
 * The contract worth pinning: a prefix is a prefix ONLY as the first
 * non-whitespace character — "case #123" must stay a bare query, or
 * every case-number search silently scopes itself to matters and
 * drops the "case" token. And prefix-only / prefix+space inputs must
 * parse to an empty term (→ "show the whole group"), not a term that
 * accidentally contains the prefix character.
 */

import { describe, expect, test } from "vitest";
import {
  parsePaletteQuery,
  paletteValue,
  scopeAllowsKind,
  splitPaletteValue,
  SCOPE_SEARCH_TYPE,
} from "./prefix";

describe("parsePaletteQuery", () => {
  test("bare queries pass through unscoped (trimmed)", () => {
    expect(parsePaletteQuery("smith")).toEqual({ scope: null, term: "smith" });
    expect(parsePaletteQuery("  ambulance report  ")).toEqual({
      scope: null,
      term: "ambulance report",
    });
    expect(parsePaletteQuery("")).toEqual({ scope: null, term: "" });
  });

  test.each([
    ["#", "matters"],
    ["@", "people"],
    [">", "actions"],
  ] as const)("prefix %s scopes to %s", (prefix, scope) => {
    expect(parsePaletteQuery(`${prefix}smith`)).toEqual({
      scope,
      term: "smith",
    });
  });

  test("prefix only → scope with empty term (show whole group)", () => {
    expect(parsePaletteQuery("#")).toEqual({ scope: "matters", term: "" });
    expect(parsePaletteQuery(">")).toEqual({ scope: "actions", term: "" });
  });

  test("prefix + space parses the same as prefix glued to the term", () => {
    expect(parsePaletteQuery("# smith jones")).toEqual({
      scope: "matters",
      term: "smith jones",
    });
    expect(parsePaletteQuery("@ ")).toEqual({ scope: "people", term: "" });
  });

  test("leading whitespace before the prefix still scopes", () => {
    expect(parsePaletteQuery("  #smith")).toEqual({
      scope: "matters",
      term: "smith",
    });
  });

  test("mid-word # is a literal character, not a scope", () => {
    expect(parsePaletteQuery("case #123")).toEqual({
      scope: null,
      term: "case #123",
    });
    expect(parsePaletteQuery("jane@doe.com")).toEqual({
      scope: null,
      term: "jane@doe.com",
    });
  });

  test("doubled prefix: first char scopes, the rest is the term", () => {
    expect(parsePaletteQuery("##foo")).toEqual({
      scope: "matters",
      term: "#foo",
    });
  });
});

describe("paletteValue / splitPaletteValue", () => {
  test("round-trips kind + text", () => {
    const v = paletteValue("matter", "Smith v. Jones 2026-CV-001");
    expect(splitPaletteValue(v)).toEqual({
      kind: "matter",
      text: "Smith v. Jones 2026-CV-001",
    });
  });

  test("untagged and unknown-tag values come back kind:null, untouched", () => {
    expect(splitPaletteValue("plain old value")).toEqual({
      kind: null,
      text: "plain old value",
    });
    expect(splitPaletteValue("$bogus$ something")).toEqual({
      kind: null,
      text: "$bogus$ something",
    });
  });
});

describe("scopeAllowsKind", () => {
  test("matters → matter only", () => {
    expect(scopeAllowsKind("matters", "matter")).toBe(true);
    expect(scopeAllowsKind("matters", "person")).toBe(false);
    expect(scopeAllowsKind("matters", "lead")).toBe(false);
    expect(scopeAllowsKind("matters", "action")).toBe(false);
  });

  test("people → person AND lead (leads are people)", () => {
    expect(scopeAllowsKind("people", "person")).toBe(true);
    expect(scopeAllowsKind("people", "lead")).toBe(true);
    expect(scopeAllowsKind("people", "matter")).toBe(false);
  });

  test("actions → action only; null kind never matches a scope", () => {
    expect(scopeAllowsKind("actions", "action")).toBe(true);
    expect(scopeAllowsKind("actions", "matter")).toBe(false);
    expect(scopeAllowsKind("matters", null)).toBe(false);
    expect(scopeAllowsKind("actions", null)).toBe(false);
  });
});

describe("SCOPE_SEARCH_TYPE", () => {
  test("matters/people map to /search ?type= groups; actions has none", () => {
    expect(SCOPE_SEARCH_TYPE.matters).toBe("matter");
    expect(SCOPE_SEARCH_TYPE.people).toBe("contact");
    expect(SCOPE_SEARCH_TYPE.actions).toBeNull();
  });
});
