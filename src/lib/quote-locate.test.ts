/**
 * Unit tests for locateQuote — the pure chunk/offset math behind the
 * viewer's quote-anchor navigation (scroll-to-highlight).
 */

import { describe, expect, test } from "vitest";
import { locateQuote } from "./quote-locate";

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
    // Cross-block selections carry separators no text node has.
    expect(locateQuote(["para one", "para two"], "one\npara")).toBeNull();
  });
});
