/**
 * Flag-anchor helpers — the FlaggedMoment anchor union in one place.
 *
 * A flag anchors to a document in AT MOST ONE of three ways, matched
 * to the document's renderer type (see the schema comments on
 * `FlaggedMoment` and the fit check in
 * `src/app/actions/flagged-moments.ts`):
 *
 *   time  — `timeSeconds` (+ optional `endSeconds` span), audio/video
 *   page  — `pageNumber` (1-based), PDFs
 *   quote — `quote` (captured selection), rendered docx/text/csv
 *
 * All three null = an anchorless flag on the document as a whole
 * (kind "document") — the only kind image / legacy-.doc /
 * unsupported files accept.
 *
 * Pure functions so the moments rail, the Evidence tab, and the
 * action layer's activity titles all agree on one kind resolution
 * and one label notation.
 */

import { formatMediaSpan } from "@/lib/media-time";

/** Hard page ceiling shared with the server action — no court file
 *  runs longer, and it bounds obvious typos ("page 20026"). */
export const MAX_PDF_PAGE = 5000;

/** Quote anchors cap at the description length — a "quote" longer
 *  than this is a selection mistake, not an anchor. */
export const MAX_QUOTE_CHARS = 500;

/** Label snippet length for quote anchors. */
const QUOTE_SNIPPET_CHARS = 40;

export type FlagAnchorKind = "time" | "page" | "quote" | "document";

/** The nullable anchor columns as they come off a FlaggedMoment row.
 *  `timeSeconds` is required in the type (it's in every row shape);
 *  the others default to absent for older call sites. */
export type FlagAnchorFields = {
  timeSeconds: number | null;
  endSeconds?: number | null;
  pageNumber?: number | null;
  quote?: string | null;
};

/** Which anchor kind a row carries. Rows are written with at most
 *  one non-null anchor (action-layer invariant); precedence order
 *  here only matters for corrupt rows and mirrors column order. */
export function flagAnchorKind(flag: FlagAnchorFields): FlagAnchorKind {
  if (flag.timeSeconds != null) return "time";
  if (flag.pageNumber != null) return "page";
  if (flag.quote != null && flag.quote !== "") return "quote";
  return "document";
}

/**
 * Human label for a flag's anchor — the one notation shared by the
 * moments rail, the Evidence tab, and activity-log titles:
 *
 *   time  → "1:15" / "1:15–2:30"  (formatMediaSpan)
 *   page  → "p. 12"
 *   quote → "“first 40 chars…”"
 *   none  → "Document"
 */
export function flagAnchorLabel(flag: FlagAnchorFields): string {
  switch (flagAnchorKind(flag)) {
    case "time":
      return formatMediaSpan(flag.timeSeconds as number, flag.endSeconds);
    case "page":
      return `p. ${flag.pageNumber}`;
    case "quote": {
      const q = (flag.quote as string).trim();
      const snippet =
        q.length > QUOTE_SNIPPET_CHARS
          ? `${q.slice(0, QUOTE_SNIPPET_CHARS - 1).trimEnd()}…`
          : q;
      return `“${snippet}”`;
    }
    case "document":
      return "Document";
  }
}
