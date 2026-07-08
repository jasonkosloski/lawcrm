/**
 * Case-insensitive quote location across a list of text chunks —
 * the pure core of the viewer's quote-anchor navigation.
 *
 * The TextReview component walks the rendered container's text nodes
 * (TreeWalker), hands their `textContent` strings here in document
 * order, and maps the returned chunk/offset endpoints back to a DOM
 * Range for scroll + highlight.
 *
 * Matching is an exact substring match on the CONCATENATED chunks,
 * lowercased. That means a quote captured inside one paragraph/cell
 * always relocates; a selection that crossed block boundaries may
 * not (`Selection.toString()` inserts newlines/tabs between blocks
 * that don't exist in any text node). Callers treat null as "quote
 * not found in the current render" and say so — never fail silently.
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

/** First case-insensitive occurrence of `quote` (trimmed) in the
 *  concatenation of `chunks`, or null when absent / empty. */
export function locateQuote(
  chunks: readonly string[],
  quote: string
): QuoteLocation | null {
  const needle = quote.trim().toLowerCase();
  if (needle === "") return null;

  const haystack = chunks.join("").toLowerCase();
  const start = haystack.indexOf(needle);
  if (start === -1) return null;
  const end = start + needle.length; // exclusive

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
  // Unreachable when indexOf matched, but keep the types honest.
  if (startChunk === -1 || endChunk === -1) return null;
  return { startChunk, startOffset, endChunk, endOffset };
}
