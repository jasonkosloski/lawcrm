/**
 * Unit tests for locateQuote — the pure chunk/offset math behind the
 * viewer's quote-anchor navigation (scroll-to-highlight).
 */

import { describe, expect, test } from "vitest";
import { countQuoteOccurrences, locateQuote } from "./quote-locate";

describe("locateQuote", () => {
  test("match inside a single chunk", () => {
    expect(locateQuote(["the officer drew his weapon"], "officer drew")).toEqual({
      startChunk: 0,
      startOffset: 4,
      endChunk: 0,
      endOffset: 16,
    });
  });

  test("match is case-insensitive both ways", () => {
    expect(locateQuote(["The Officer DREW"], "the officer drew")).toEqual({
      startChunk: 0,
      startOffset: 0,
      endChunk: 0,
      endOffset: 16,
    });
    expect(locateQuote(["the officer drew"], "THE OFFICER")).not.toBeNull();
  });

  test("quote is trimmed before matching", () => {
    expect(locateQuote(["hello world"], "  world ")).toEqual({
      startChunk: 0,
      startOffset: 6,
      endChunk: 0,
      endOffset: 11,
    });
  });

  test("match spanning multiple chunks maps both endpoints", () => {
    // "the offi" | "cer drew his" | " weapon"
    const loc = locateQuote(
      ["the offi", "cer drew his", " weapon"],
      "officer drew his weapon"
    );
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 4,
      endChunk: 2,
      endOffset: 7, // exclusive — end of " weapon"
    });
  });

  test("empty chunks between text are skipped, offsets stay correct", () => {
    const loc = locateQuote(["ab", "", "cdef"], "bcd");
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 1,
      endChunk: 2,
      endOffset: 2,
    });
  });

  test("match ending exactly at a chunk boundary stays in that chunk", () => {
    const loc = locateQuote(["abcd", "efgh"], "cd");
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 2,
      endChunk: 0,
      endOffset: 4, // exclusive end == chunk length, not chunk 1 offset 0
    });
  });

  test("first occurrence wins", () => {
    const loc = locateQuote(["say it, say it again"], "say it");
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 0,
      endChunk: 0,
      endOffset: 6,
    });
  });

  test("no match / empty inputs return null", () => {
    expect(locateQuote(["hello world"], "goodbye")).toBeNull();
    expect(locateQuote([], "anything")).toBeNull();
    expect(locateQuote(["hello"], "")).toBeNull();
    expect(locateQuote(["hello"], "   ")).toBeNull();
    expect(locateQuote(["hello"], "\n \t")).toBeNull();
  });
});

describe("locateQuote — whitespace-insensitive (F400)", () => {
  test("a selection crossing paragraphs relocates despite newline separators", () => {
    // Selection.toString() joins blocks with "\n"; the text nodes
    // have no such character.
    const chunks = ["Q. Did you see him?", "A. Yes, I did.", "Q. Where?"];
    const loc = locateQuote(chunks, "Did you see him?\nA. Yes, I did.");
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 3,
      endChunk: 1,
      endOffset: 14,
    });
  });

  test("table cells joined by tabs relocate", () => {
    expect(
      locateQuote(
        ["Smith", "Officer", "2026-01-04"],
        "Smith\tOfficer\t2026-01-04"
      )
    ).toEqual({ startChunk: 0, startOffset: 0, endChunk: 2, endOffset: 10 });
  });

  test("runs of spaces and NBSP in the document match single spaces in the quote", () => {
    const chunks = ["He left.  Then  she  left."];
    const loc = locateQuote(chunks, "left. Then she");
    expect(chunks[0].slice(loc!.startOffset, loc!.endOffset)).toBe(
      "left.  Then  she"
    );
  });

  test("highlight ends on a real character, not trailing whitespace", () => {
    const loc = locateQuote(["abc   ", "   def"], "abc def");
    expect(loc).toEqual({
      startChunk: 0,
      startOffset: 0,
      endChunk: 1,
      endOffset: 6,
    });
  });
});

describe("locateQuote — case folding that changes length (F1009)", () => {
  test("a dotted capital I before the match does not shift the highlight", () => {
    const chunks = ["İSTANBUL POLICE REPORT", "The officer drew his weapon"];
    expect(locateQuote(chunks, "officer drew")).toEqual({
      startChunk: 1,
      startOffset: 4,
      endChunk: 1,
      endOffset: 16,
    });
  });

  test("many length-changing characters do not turn a match into null", () => {
    expect(locateQuote(["İİİ", "ab"], "ab")).toEqual({
      startChunk: 1,
      startOffset: 0,
      endChunk: 1,
      endOffset: 2,
    });
  });

  test("offsets never exceed the chunk lengths (Range-safe)", () => {
    const chunks = ["İİ", "İxİ"];
    const loc = locateQuote(chunks, "x")!;
    expect(loc.startOffset).toBeLessThanOrEqual(chunks[loc.startChunk].length);
    expect(loc.endOffset).toBeLessThanOrEqual(chunks[loc.endChunk].length);
    expect(
      chunks[loc.startChunk].slice(loc.startOffset, loc.endOffset)
    ).toBe("x");
  });

  test("astral characters (surrogate pairs) keep correct offsets", () => {
    const chunks = ["\u{1F600} smile \u{10400}", "tail"];
    const loc = locateQuote(chunks, "smile")!;
    expect(chunks[0].slice(loc.startOffset, loc.endOffset)).toBe("smile");
  });
});

describe("countQuoteOccurrences", () => {
  test("counts repeated passages under the same normalization", () => {
    const chunks = ["I don't recall.", "Q. Again?", "A. I don't  recall."];
    expect(countQuoteOccurrences(chunks, "I DON'T RECALL.")).toBe(2);
  });

  test("absent / empty quotes count zero", () => {
    expect(countQuoteOccurrences(["abc"], "xyz")).toBe(0);
    expect(countQuoteOccurrences(["abc"], "   ")).toBe(0);
  });
});
