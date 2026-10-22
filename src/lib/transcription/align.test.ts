import { describe, expect, it } from "vitest";
import { alignWords } from "./align";
import type { Word } from "./types";

const W = (w: string, s: number, e: number): Word => ({ w, s, e });

describe("alignWords", () => {
  it("returns identical words for unchanged text", () => {
    const old = [W("a", 1, 2), W("b", 5, 6)];
    expect(alignWords(old, "a b")).toEqual(old);
  });

  it("replacement inherits the replaced word's timing", () => {
    const old = [W("a", 1, 2), W("b", 3, 4), W("c", 5, 6)];
    expect(alignWords(old, "a X c")).toEqual([W("a", 1, 2), W("X", 3, 4), W("c", 5, 6)]);
  });

  it("insertion spreads evenly between neighbours", () => {
    const old = [W("a", 1, 2), W("b", 5, 6)];
    expect(alignWords(old, "a x y b")).toEqual([
      W("a", 1, 2),
      W("x", 2, 3.5),
      W("y", 3.5, 5),
      W("b", 5, 6),
    ]);
  });

  it("deletion drops the word", () => {
    const old = [W("a", 1, 2), W("b", 3, 4), W("c", 5, 6)];
    expect(alignWords(old, "a c")).toEqual([W("a", 1, 2), W("c", 5, 6)]);
  });

  it("leading insertion has zero width at the first word start", () => {
    const old = [W("a", 1, 2), W("b", 3, 4)];
    const out = alignWords(old, "x a b");
    expect(out[0]).toEqual(W("x", 1, 1));
    expect(out.slice(1)).toEqual(old);
  });

  it("trailing insertion spreads after the last word to its end", () => {
    const out = alignWords([W("a", 1, 2)], "a b");
    expect(out[0]).toEqual(W("a", 1, 2));
    expect(out[1].s).toBe(2);
  });

  it("punctuation/case differences match but new spelling is kept", () => {
    const old = [W("hello", 1, 2), W("world", 3, 4)];
    expect(alignWords(old, "Hello, world")).toEqual([W("Hello,", 1, 2), W("world", 3, 4)]);
  });

  it("preserves confidence on matched words", () => {
    const out = alignWords([{ w: "a", s: 1, e: 2, c: 0.9 }], "A");
    expect(out[0].c).toBe(0.9);
  });
});
