import { describe, expect, it } from "vitest";
import { activeWordIndex, formatShortTimecode, formatTimecode } from "./timecode";

describe("timecode", () => {
  it("formatTimecode", () => {
    expect(formatTimecode(252)).toBe("00:04:12");
    expect(formatTimecode(3852.9)).toBe("01:04:12");
  });
  it("formatShortTimecode", () => {
    expect(formatShortTimecode(252)).toBe("4:12");
    expect(formatShortTimecode(3852)).toBe("1:04:12");
  });
});

describe("activeWordIndex", () => {
  const words = [
    { w: "a", s: 1, e: 2 },
    { w: "b", s: 3, e: 4 },
    { w: "c", s: 6, e: 7 },
  ];
  it("is -1 before the first word", () => expect(activeWordIndex(words, 0.5)).toBe(-1));
  it("hits a word at its start", () => expect(activeWordIndex(words, 3)).toBe(1));
  it("uses the previous word between words", () => expect(activeWordIndex(words, 5)).toBe(1));
  it("handles empty and past-the-end", () => {
    expect(activeWordIndex([], 1)).toBe(-1);
    expect(activeWordIndex(words, 100)).toBe(2);
  });
});
