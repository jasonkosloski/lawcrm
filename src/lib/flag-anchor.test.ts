/**
 * Unit tests for the flag-anchor helpers — one kind resolution and
 * one label notation for the moments rail, the Evidence tab, and
 * activity-log titles.
 */

import { describe, expect, test } from "vitest";
import { flagAnchorKind, flagAnchorLabel } from "./flag-anchor";

describe("flagAnchorKind", () => {
  test("time wins when timeSeconds is set", () => {
    expect(flagAnchorKind({ timeSeconds: 75 })).toBe("time");
    expect(flagAnchorKind({ timeSeconds: 0 })).toBe("time"); // 0:00 is a real anchor
  });

  test("page and quote kinds", () => {
    expect(flagAnchorKind({ timeSeconds: null, pageNumber: 12 })).toBe("page");
    expect(flagAnchorKind({ timeSeconds: null, quote: "the officer said" })).toBe(
      "quote"
    );
  });

  test("all-null (and absent) anchors resolve to document", () => {
    expect(flagAnchorKind({ timeSeconds: null })).toBe("document");
    expect(
      flagAnchorKind({
        timeSeconds: null,
        endSeconds: null,
        pageNumber: null,
        quote: null,
      })
    ).toBe("document");
    // Corrupt row degradation: empty-string quote reads as anchorless.
    expect(flagAnchorKind({ timeSeconds: null, quote: "" })).toBe("document");
  });
});

describe("flagAnchorLabel", () => {
  test("time anchors use the media clock notation", () => {
    expect(flagAnchorLabel({ timeSeconds: 75 })).toBe("1:15");
    expect(flagAnchorLabel({ timeSeconds: 42, endSeconds: 65 })).toBe(
      "0:42–1:05"
    );
  });

  test("page anchors", () => {
    expect(flagAnchorLabel({ timeSeconds: null, pageNumber: 12 })).toBe("p. 12");
    expect(flagAnchorLabel({ timeSeconds: null, pageNumber: 1 })).toBe("p. 1");
  });

  test("short quotes render whole, in curly quotes", () => {
    expect(
      flagAnchorLabel({ timeSeconds: null, quote: "no further questions" })
    ).toBe("“no further questions”");
  });

  test("long quotes truncate to a 40-char snippet with an ellipsis", () => {
    const quote =
      "the witness stated that she had never seen the defendant before that evening";
    const label = flagAnchorLabel({ timeSeconds: null, quote });
    expect(label.startsWith("“")).toBe(true);
    expect(label.endsWith("…”")).toBe(true);
    // “ + 40 chars max (incl. the ellipsis) + ”
    expect(label.length).toBeLessThanOrEqual(42);
    expect(label).toContain("the witness stated");
  });

  test("snippet trims trailing whitespace before the ellipsis", () => {
    // Cut point lands right after a space — no "word …" gap.
    const quote = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bcdef"; // space at index 38
    expect(flagAnchorLabel({ timeSeconds: null, quote })).toBe(
      "“aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…”"
    );
  });

  test("quote label trims the stored value", () => {
    expect(flagAnchorLabel({ timeSeconds: null, quote: "  padded  " })).toBe(
      "“padded”"
    );
  });

  test("anchorless flags label as Document", () => {
    expect(flagAnchorLabel({ timeSeconds: null })).toBe("Document");
  });
});
