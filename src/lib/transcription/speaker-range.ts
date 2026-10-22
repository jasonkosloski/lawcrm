/**
 * "Change speaker" for a selected run of words. Paragraphs only partly
 * selected split (before / selected / after); whole ones are relabelled;
 * neighbours that end up with the same speaker merge, and anything past
 * the import cap re-splits at sentence ends. Words (text and timings)
 * never change, only paragraph boundaries and labels. Pure: the action
 * applies the result under the transcript lock.
 */

import { splitTurn, wordsToText } from "./normalize";
import type { Word } from "./types";

export type RangeSegment = { id: string; index: number; speaker: string; words: Word[] };

/** Selection bounds: paragraph id + word index, inclusive, either order. */
export type WordPoint = { segmentId: string; word: number };

export type NewSegment = {
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: Word[];
};

export type RangeReassignment =
  | { kind: "noop" }
  | {
      kind: "replace";
      /** Inclusive positions (in the ordered list) of the rows to replace. */
      from: number;
      to: number;
      segments: NewSegment[];
    };

/**
 * Returns null when the selection doesn't fit the transcript (unknown
 * paragraph, word out of range) — the caller treats that as stale.
 */
export function reassignSpeakerRange(
  ordered: RangeSegment[],
  a: WordPoint,
  b: WordPoint,
  speaker: string
): RangeReassignment | null {
  let p0 = ordered.findIndex((s) => s.id === a.segmentId);
  let p1 = ordered.findIndex((s) => s.id === b.segmentId);
  if (p0 < 0 || p1 < 0) return null;
  let w0 = a.word;
  let w1 = b.word;
  if (p0 > p1 || (p0 === p1 && w0 > w1)) {
    [p0, p1, w0, w1] = [p1, p0, w1, w0];
  }
  const inRange = (p: number, w: number) => Number.isInteger(w) && w >= 0 && w < ordered[p]!.words.length;
  if (!inRange(p0, w0) || !inRange(p1, w1)) return null;

  const turns: { speaker: string; words: Word[] }[] = [];
  const first = ordered[p0]!;
  const last = ordered[p1]!;
  if (w0 > 0) turns.push({ speaker: first.speaker, words: first.words.slice(0, w0) });
  const selected: Word[] = [];
  let changed = false;
  for (let p = p0; p <= p1; p++) {
    const seg = ordered[p]!;
    const lo = p === p0 ? w0 : 0;
    const hi = p === p1 ? w1 : seg.words.length - 1;
    if (seg.speaker !== speaker) changed = true;
    selected.push(...seg.words.slice(lo, hi + 1));
  }
  if (!changed) return { kind: "noop" };
  turns.push({ speaker, words: selected });
  if (w1 < last.words.length - 1) turns.push({ speaker: last.speaker, words: last.words.slice(w1 + 1) });

  // Pull in same-speaker neighbours so labels don't repeat back to back.
  let from = p0;
  let to = p1;
  const prev = ordered[p0 - 1];
  if (prev && prev.speaker === turns[0]!.speaker) {
    turns.unshift({ speaker: prev.speaker, words: prev.words });
    from--;
  }
  const next = ordered[p1 + 1];
  if (next && next.speaker === turns[turns.length - 1]!.speaker) {
    turns.push({ speaker: next.speaker, words: next.words });
    to++;
  }

  const merged: { speaker: string; words: Word[] }[] = [];
  for (const t of turns) {
    const tail = merged[merged.length - 1];
    if (tail && tail.speaker === t.speaker) tail.words = [...tail.words, ...t.words];
    else merged.push({ speaker: t.speaker, words: [...t.words] });
  }

  const segments: NewSegment[] = merged.flatMap((t) =>
    splitTurn(t.words).map((words) => ({
      speaker: t.speaker,
      startSeconds: words[0]!.s,
      endSeconds: words[words.length - 1]!.e,
      text: wordsToText(words),
      words,
    }))
  );
  return { kind: "replace", from, to, segments };
}
