/**
 * Case- and whitespace-insensitive quote location across a list of
 * text chunks — the pure core of the viewer's quote-anchor
 * navigation.
 *
 * The TextReview component walks the rendered container's text nodes
 * (TreeWalker), hands their `textContent` strings here in document
 * order, and maps the returned chunk/offset endpoints back to a DOM
 * Range for scroll + highlight.
 *
 * Matching runs on a NORMALIZED view of the concatenated chunks:
 * every whitespace character (incl. NBSP and zero-width spaces) is
 * dropped and the rest is lowercased. A captured selection
 * (`Selection.toString()`) inserts newlines/tabs between paragraphs,
 * list items and table cells that exist in no text node, and reports
 * rendered (collapsed) whitespace where the text nodes keep raw runs
 * of spaces — exact whitespace matching could therefore never
 * relocate a quote that crossed a block boundary (a deposition Q/A
 * pair, a CSV row). Dropping whitespace on BOTH sides makes those
 * relocate; the cost is a slightly higher false-positive rate
 * ("a b" and "ab" are the same quote), which is irrelevant for
 * human-length passages.
 *
 * The normalized string carries an index map back to the original
 * chunk offsets (per source character, so a case fold that changes
 * the string length — "İ".toLowerCase() is two code units — can
 * never shift a highlight). Offsets always land on real characters.
 *
 * Callers treat null as "quote not found in the current render" and
 * say so — never fail silently.
 */

export type QuoteLocation = {
  /** Index into the chunks array where the match starts. */
  startChunk: number;
  /** Character offset within that chunk (0-based, inclusive). */
  startOffset: number;
  /** Index of the chunk containing the match's last character. */
  endChunk: number;
  /** Offset within the end chunk, EXCLUSIVE — Range-style. */
  endOffset: number;
};

/** Characters ignored when comparing: \s covers NBSP, line/paragraph
 *  separators and Unicode Zs; the rest are invisible format chars a
 *  renderer may or may not emit. */
const IGNORED = /[\s­​-‍⁠﻿]/;

/** Normalized form of a needle: ignored chars dropped, rest lowercased. */
function normalizeNeedle(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!IGNORED.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

type NormalizedHaystack = {
  text: string;
  /** For each unit of `text`: [start, end) in the JOINED original string. */
  starts: number[];
  ends: number[];
};

function normalizeHaystack(chunks: readonly string[]): NormalizedHaystack {
  const joined = chunks.join("");
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < joined.length) {
    const cp = joined.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    const next = i + ch.length;
    if (!IGNORED.test(ch)) {
      const folded = ch.toLowerCase();
      for (let k = 0; k < folded.length; k++) {
        starts.push(i);
        ends.push(next);
      }
      text += folded;
    }
    i = next;
  }
  return { text, starts, ends };
}

/** Map [start, end) in the joined original string to chunk/offset endpoints. */
function toLocation(
  chunks: readonly string[],
  start: number,
  end: number
): QuoteLocation | null {
  let startChunk = -1;
  let startOffset = 0;
  let endChunk = -1;
  let endOffset = 0;
  let consumed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const len = chunks[i].length;
    // Start lands in the first chunk that still has characters at
    // or past `start` (empty chunks can never host it).
    if (startChunk === -1 && start < consumed + len) {
      startChunk = i;
      startOffset = start - consumed;
    }
    // End (exclusive) belongs to the chunk containing the match's
    // LAST character, i.e. index end - 1.
    if (end - 1 < consumed + len) {
      endChunk = i;
      endOffset = end - consumed;
      break;
    }
    consumed += len;
  }
  if (startChunk === -1 || endChunk === -1) return null;
  return { startChunk, startOffset, endChunk, endOffset };
}

/** First case/whitespace-insensitive occurrence of `quote` in the
 *  concatenation of `chunks`, or null when absent / empty. */
export function locateQuote(
  chunks: readonly string[],
  quote: string
): QuoteLocation | null {
  const needle = normalizeNeedle(quote);
  if (needle === "") return null;
  const hay = normalizeHaystack(chunks);
  const at = hay.text.indexOf(needle);
  if (at === -1) return null;
  return toLocation(chunks, hay.starts[at], hay.ends[at + needle.length - 1]);
}

/** Non-overlapping occurrences of `quote` under the same
 *  normalization as `locateQuote` — lets capture warn that a quote
 *  appears more than once (relocation always picks the first). */
export function countQuoteOccurrences(
  chunks: readonly string[],
  quote: string
): number {
  const needle = normalizeNeedle(quote);
  if (needle === "") return 0;
  const { text } = normalizeHaystack(chunks);
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}
