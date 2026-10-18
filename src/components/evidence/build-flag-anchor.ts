/**
 * Anchor-field parsing for the flag composer — the pure rules that
 * turn the form's text inputs into the anchor part of a
 * `FlagInput`, or a field error. Extracted from FlagComposer so the
 * rules are unit-testable without rendering.
 *
 * Rules per kind:
 *   time     — start is a clock time (mm:ss / h:mm:ss); the optional
 *              span end must parse and come after the start
 *   page     — blank = on CREATE a whole-document flag (no anchor), on
 *              EDIT an error (the kind is locked server-side); else a
 *              whole number within 1..MAX_PDF_PAGE
 *   quote    — trimmed, non-empty, capped at MAX_QUOTE_CHARS
 *   document — no anchor fields
 */

import type { FlagInput } from "@/app/actions/flagged-moments";
import { parseMediaTime } from "@/lib/media-time";
import {
  MAX_PDF_PAGE,
  MAX_PDF_PAGE_SPAN,
  MAX_QUOTE_CHARS,
  type FlagAnchorKind,
} from "@/lib/flag-anchor";

export type FlagAnchorText = {
  timeText: string;
  endText: string;
  pageText: string;
  /** Optional last page of a span (blank = single page). */
  endPageText?: string;
  quoteText: string;
};

export type BuildAnchorResult =
  | { ok: true; anchor: Partial<FlagInput> }
  | { ok: false; error: string };

export function buildFlagAnchor(
  kind: FlagAnchorKind,
  text: FlagAnchorText,
  /** True when editing an existing flag (page kind cannot go blank). */
  editing: boolean
): BuildAnchorResult {
  switch (kind) {
    case "time": {
      const timeSeconds = parseMediaTime(text.timeText);
      if (timeSeconds === null) {
        return { ok: false, error: "Start time must be a clock time like 1:15" };
      }
      if (text.endText.trim() === "") {
        return { ok: true, anchor: { timeSeconds } };
      }
      const endSeconds = parseMediaTime(text.endText);
      if (endSeconds === null) {
        return {
          ok: false,
          error: "Span end must be a clock time like 2:30 (or blank)",
        };
      }
      if (endSeconds <= timeSeconds) {
        return { ok: false, error: "Span end must be after the start time" };
      }
      return { ok: true, anchor: { timeSeconds, endSeconds } };
    }
    case "page": {
      const trimmed = text.pageText.trim();
      // Text selected in the PDF viewer rides with its page.
      const quote = text.quoteText.trim().slice(0, MAX_QUOTE_CHARS);
      if (trimmed === "" && (text.endPageText ?? "").trim() !== "") {
        return { ok: false, error: "A page span needs its first page" };
      }
      if (trimmed === "" && quote !== "") {
        return {
          ok: false,
          error: "A quoted passage needs the page it's on",
        };
      }
      if (trimmed === "") {
        // Create: blank page = flag the whole document. Edit: the
        // kind is locked server-side, so require a page.
        if (!editing) return { ok: true, anchor: {} };
        return {
          ok: false,
          error: "This flag anchors to a page — enter a page number",
        };
      }
      if (!/^\d+$/.test(trimmed)) {
        return { ok: false, error: "Page must be a whole number" };
      }
      const pageNumber = Number(trimmed);
      if (pageNumber < 1 || pageNumber > MAX_PDF_PAGE) {
        return {
          ok: false,
          error: `Page must be between 1 and ${MAX_PDF_PAGE}`,
        };
      }
      const endTrimmed = (text.endPageText ?? "").trim();
      let endPageNumber: number | undefined;
      if (endTrimmed !== "" && endTrimmed !== trimmed) {
        if (!/^\d+$/.test(endTrimmed)) {
          return { ok: false, error: "The last page must be a whole number (or blank)" };
        }
        endPageNumber = Number(endTrimmed);
        if (endPageNumber < pageNumber) {
          return { ok: false, error: "The last page can't be before the first" };
        }
        if (endPageNumber > MAX_PDF_PAGE) {
          return { ok: false, error: `Page must be between 1 and ${MAX_PDF_PAGE}` };
        }
        if (endPageNumber - pageNumber + 1 > MAX_PDF_PAGE_SPAN) {
          return { ok: false, error: `A flag can span at most ${MAX_PDF_PAGE_SPAN} pages` };
        }
      }
      return {
        ok: true,
        anchor: {
          pageNumber,
          ...(endPageNumber !== undefined ? { endPageNumber } : {}),
          ...(quote ? { quote } : {}),
        },
      };
    }
    case "quote": {
      const quote = text.quoteText.trim();
      if (quote === "") {
        return { ok: false, error: "The quoted text can't be empty" };
      }
      return { ok: true, anchor: { quote: quote.slice(0, MAX_QUOTE_CHARS) } };
    }
    case "document":
      return { ok: true, anchor: {} };
  }
}
