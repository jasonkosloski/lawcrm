import { describe, expect, test } from "vitest";
import { reassignSpeakerRange, type RangeSegment } from "./speaker-range";
import type { Word } from "./types";

/** Words one second apart starting at `t0`. */
const words = (text: string, t0: number): Word[] =>
  text.split(" ").map((w, i) => ({ w, s: t0 + i, e: t0 + i + 0.5 }));

const seg = (id: string, speaker: string, text: string, t0: number): RangeSegment => ({
  id,
  index: 0,
  speaker,
  words: words(text, t0),
});

const shape = (r: ReturnType<typeof reassignSpeakerRange>) =>
  r && r.kind === "replace"
    ? { from: r.from, to: r.to, segs: r.segments.map((s) => `${s.speaker}:${s.text}`) }
    : r;

describe("reassignSpeakerRange", () => {
  const A1 = seg("a1", "A", "one two three four five", 0);
  const B1 = seg("b1", "B", "six seven eight", 10);
  const A2 = seg("a2", "A", "nine ten", 20);

  test("the middle of a paragraph splits into three", () => {
    const r = reassignSpeakerRange(
      [A1, B1, A2],
      { segmentId: "a1", word: 1 },
      { segmentId: "a1", word: 2 },
      "C",
    );
    expect(shape(r)).toEqual({ from: 0, to: 0, segs: ["A:one", "C:two three", "A:four five"] });
  });

  test("the tail of a paragraph merges into a same-speaker next paragraph", () => {
    const r = reassignSpeakerRange(
      [A1, B1, A2],
      { segmentId: "a1", word: 3 },
      { segmentId: "a1", word: 4 },
      "B",
    );
    expect(shape(r)).toEqual({
      from: 0,
      to: 1,
      segs: ["A:one two three", "B:four five six seven eight"],
    });
  });

  test("a whole paragraph relabelled merges with both neighbours", () => {
    const r = reassignSpeakerRange(
      [A1, B1, A2],
      { segmentId: "b1", word: 0 },
      { segmentId: "b1", word: 2 },
      "A",
    );
    expect(shape(r)).toEqual({
      from: 0,
      to: 2,
      segs: ["A:one two three four five six seven eight nine ten"],
    });
  });

  test("a selection across paragraphs, given end-first", () => {
    const r = reassignSpeakerRange(
      [A1, B1, A2],
      { segmentId: "b1", word: 0 },
      { segmentId: "a1", word: 4 },
      "C",
    );
    expect(shape(r)).toEqual({
      from: 0,
      to: 1,
      segs: ["A:one two three four", "C:five six", "B:seven eight"],
    });
  });

  test("timings are the words' own; nothing is re-timed", () => {
    const r = reassignSpeakerRange(
      [A1],
      { segmentId: "a1", word: 1 },
      { segmentId: "a1", word: 2 },
      "B",
    );
    if (!r || r.kind !== "replace") throw new Error("expected replace");
    const mid = r.segments[1]!;
    expect(mid.words).toEqual(A1.words.slice(1, 3));
    expect([mid.startSeconds, mid.endSeconds]).toEqual([1, 2.5]);
  });

  test("already that speaker → noop", () => {
    expect(
      reassignSpeakerRange(
        [A1, B1],
        { segmentId: "a1", word: 1 },
        { segmentId: "a1", word: 2 },
        "A",
      ),
    ).toEqual({
      kind: "noop",
    });
  });

  test("a stale selection → null", () => {
    expect(
      reassignSpeakerRange([A1], { segmentId: "zz", word: 0 }, { segmentId: "a1", word: 0 }, "B"),
    ).toBeNull();
    expect(
      reassignSpeakerRange([A1], { segmentId: "a1", word: 0 }, { segmentId: "a1", word: 9 }, "B"),
    ).toBeNull();
  });

  test("a merged turn past the cap re-splits at a sentence end", () => {
    const long: RangeSegment = {
      id: "l",
      index: 0,
      speaker: "B",
      words: Array.from({ length: 60 }, (_, i) => ({
        w: i === 29 ? "end." : `w${i}`,
        s: i * 2,
        e: i * 2 + 1,
      })),
    };
    const prev: RangeSegment = {
      id: "p",
      index: 0,
      speaker: "A",
      words: [{ w: "hi", s: -2, e: -1 }],
    };
    const r = reassignSpeakerRange(
      [prev, long],
      { segmentId: "l", word: 0 },
      { segmentId: "l", word: 59 },
      "A",
    );
    if (!r || r.kind !== "replace") throw new Error("expected replace");
    expect(r.segments.length).toBeGreaterThan(1);
    expect(r.segments.every((s) => s.speaker === "A")).toBe(true);
    expect(r.segments.flatMap((s) => s.words)).toHaveLength(61);
  });
});
