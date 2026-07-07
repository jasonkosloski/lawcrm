/**
 * Search snippet renderer + the highlight-marker protocol.
 *
 * `globalSearch` (src/lib/queries/search.ts) returns snippets as
 * plain strings with the matched range wrapped in the two control
 * characters below. Control chars (not e.g. "[[" / "**") because
 * they can't legitimately appear in user text, so the split-based
 * parser can't be confused by content.
 *
 * The constants live HERE (not in the query module) deliberately:
 * this file has zero server deps, so component tests can import it
 * without dragging Prisma / auth into the module graph. The query
 * layer imports the constants from here.
 */

export const SNIPPET_MARK_START = "\u0001";
export const SNIPPET_MARK_END = "\u0002";

/** Renders a marker-encoded snippet, wrapping each highlighted
 *  range in a <mark>. Everything outside markers renders verbatim
 *  (React escapes it — snippets are plain text by the time they
 *  leave the query layer, never HTML). */
export function SearchSnippet({ snippet }: { snippet: string }) {
  const segments = snippet.split(SNIPPET_MARK_START);
  return (
    <span className="text-xs text-ink-3 leading-snug">
      {segments.map((segment, i) => {
        // Segment 0 is always before the first marker; later
        // segments start with the highlighted run up to the END
        // marker, then plain text.
        if (i === 0) return <span key={i}>{segment}</span>;
        const endIdx = segment.indexOf(SNIPPET_MARK_END);
        if (endIdx === -1) {
          // Unbalanced markers shouldn't happen (the builder always
          // emits pairs) — render plain rather than dropping text.
          return <span key={i}>{segment}</span>;
        }
        return (
          <span key={i}>
            <mark className="bg-brand-100 text-brand-900 rounded-sm px-0.5">
              {segment.slice(0, endIdx)}
            </mark>
            {segment.slice(endIdx + SNIPPET_MARK_END.length)}
          </span>
        );
      })}
    </span>
  );
}
