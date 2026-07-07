/**
 * Tests for the count-label pluralizer. The contract: `plural(n,
 * noun)` never renders "1 matters"-class labels, and the regular
 * English rules cover every noun we actually count in the UI.
 */

import { describe, expect, test } from "vitest";
import { plural, pluralize } from "./utils";

describe("pluralize", () => {
  test("regular +s", () => {
    expect(pluralize("matter")).toBe("matters");
    expect(pluralize("deadline")).toBe("deadlines");
    expect(pluralize("task")).toBe("tasks");
    expect(pluralize("document")).toBe("documents");
  });

  test("sibilant endings take +es", () => {
    expect(pluralize("match")).toBe("matches");
    expect(pluralize("witness")).toBe("witnesses");
    expect(pluralize("box")).toBe("boxes");
  });

  test("consonant-y flips to -ies", () => {
    expect(pluralize("party")).toBe("parties");
    expect(pluralize("entry")).toBe("entries");
    expect(pluralize("reply")).toBe("replies");
  });

  test("vowel-y stays regular", () => {
    expect(pluralize("attorney")).toBe("attorneys");
    expect(pluralize("day")).toBe("days");
  });

  test("irregulars", () => {
    expect(pluralize("person")).toBe("people");
    expect(pluralize("child")).toBe("children");
    expect(pluralize("Person")).toBe("People");
  });

  test("explicit plural form wins", () => {
    expect(pluralize("memorandum", "memoranda")).toBe("memoranda");
  });
});

describe("plural", () => {
  test("1 stays singular", () => {
    expect(plural(1, "matter")).toBe("1 matter");
    expect(plural(1, "deadline")).toBe("1 deadline");
  });

  test("0 and 2+ pluralize", () => {
    expect(plural(0, "matter")).toBe("0 matters");
    expect(plural(2, "matter")).toBe("2 matters");
    expect(plural(5, "party")).toBe("5 parties");
  });

  test("explicit plural form", () => {
    expect(plural(3, "memorandum", "memoranda")).toBe("3 memoranda");
    expect(plural(1, "memorandum", "memoranda")).toBe("1 memorandum");
  });
});
