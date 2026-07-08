/**
 * Inline flag composer — create + edit in one form, for every
 * anchor kind:
 *
 *   time  — mm:ss start (+ optional span end), prefilled from the
 *           player's currentTime; "set to current time" clock
 *           buttons when the parent supplies `getCurrentTime`
 *   page  — a page-number input (blank on create = flag the whole
 *           document; the PDF plugin exposes no "current page" to
 *           prefill from — see PdfReview)
 *   quote — the captured selection, editable (trim + 500 cap happens
 *           server-side too)
 *   document — no anchor fields, just category + note
 *
 * Create mode gets its anchor from the renderer adapter
 * (`createAnchor`); edit mode derives the kind from the flag row
 * itself (`flagAnchorKind`) — the server rejects kind switches, so
 * the form never offers one. Submit goes straight to the server
 * action; on success the parent refreshes the route so the
 * server-fetched rail re-renders.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import {
  createFlaggedMoment,
  updateFlaggedMoment,
  type FlagInput,
} from "@/app/actions/flagged-moments";
import {
  FLAG_CATEGORIES,
  FLAG_CATEGORY_LABEL,
  type FlagCategory,
} from "@/lib/constants/flag-category";
import { formatMediaTime, parseMediaTime } from "@/lib/media-time";
import {
  MAX_PDF_PAGE,
  MAX_QUOTE_CHARS,
  flagAnchorKind,
  type FlagAnchorKind,
} from "@/lib/flag-anchor";

export type ComposerFlag = {
  id: string;
  timeSeconds: number | null;
  endSeconds: number | null;
  pageNumber: number | null;
  quote: string | null;
  category: string;
  description: string;
};

/** What the renderer adapter captured for a NEW flag. */
export type ComposerAnchor =
  | { kind: "time"; timeSeconds: number }
  | { kind: "page"; pageNumber: number | null }
  | { kind: "quote"; quote: string }
  | { kind: "document" };

export function FlagComposer({
  documentId,
  /** null = create; a flag = edit-in-place. */
  editing,
  /** Create-mode anchor from the renderer adapter; ignored on edit. */
  createAnchor,
  /** Reads the player's current position — media renderers only. */
  getCurrentTime,
  onClose,
}: {
  documentId: string;
  editing: ComposerFlag | null;
  createAnchor: ComposerAnchor | null;
  getCurrentTime?: () => number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const kind: FlagAnchorKind = editing
    ? flagAnchorKind(editing)
    : (createAnchor?.kind ?? "document");

  const [timeText, setTimeText] = useState(() =>
    kind !== "time"
      ? ""
      : formatMediaTime(
          editing
            ? (editing.timeSeconds ?? 0)
            : createAnchor?.kind === "time"
              ? createAnchor.timeSeconds
              : 0
        )
  );
  const [endText, setEndText] = useState(
    editing?.endSeconds != null ? formatMediaTime(editing.endSeconds) : ""
  );
  const [pageText, setPageText] = useState(() => {
    if (editing?.pageNumber != null) return String(editing.pageNumber);
    if (!editing && createAnchor?.kind === "page" && createAnchor.pageNumber)
      return String(createAnchor.pageNumber);
    return "";
  });
  const [quoteText, setQuoteText] = useState(
    editing?.quote ??
      (createAnchor?.kind === "quote" ? createAnchor.quote : "")
  );
  const [category, setCategory] = useState<FlagCategory>(
    editing && (FLAG_CATEGORIES as readonly string[]).includes(editing.category)
      ? (editing.category as FlagCategory)
      : "emphasis"
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const syncToPlayer = (setter: (v: string) => void) => {
    const t = getCurrentTime?.();
    if (t !== null && t !== undefined) setter(formatMediaTime(t));
  };

  /** Anchor fields for the submit, or null after setting an error. */
  const buildAnchor = (): Partial<FlagInput> | null => {
    switch (kind) {
      case "time": {
        const timeSeconds = parseMediaTime(timeText);
        if (timeSeconds === null) {
          setError("Start time must be a clock time like 1:15");
          return null;
        }
        if (endText.trim() === "") return { timeSeconds };
        const endSeconds = parseMediaTime(endText);
        if (endSeconds === null) {
          setError("Span end must be a clock time like 2:30 (or blank)");
          return null;
        }
        if (endSeconds <= timeSeconds) {
          setError("Span end must be after the start time");
          return null;
        }
        return { timeSeconds, endSeconds };
      }
      case "page": {
        const trimmed = pageText.trim();
        if (trimmed === "") {
          // Create: blank page = flag the whole document. Edit: the
          // kind is locked server-side, so require a page.
          if (!editing) return {};
          setError("This flag anchors to a page — enter a page number");
          return null;
        }
        if (!/^\d+$/.test(trimmed)) {
          setError("Page must be a whole number");
          return null;
        }
        const pageNumber = Number(trimmed);
        if (pageNumber < 1 || pageNumber > MAX_PDF_PAGE) {
          setError(`Page must be between 1 and ${MAX_PDF_PAGE}`);
          return null;
        }
        return { pageNumber };
      }
      case "quote": {
        const quote = quoteText.trim();
        if (quote === "") {
          setError("The quoted text can't be empty");
          return null;
        }
        return { quote: quote.slice(0, MAX_QUOTE_CHARS) };
      }
      case "document":
        return {};
    }
  };

  const submit = () => {
    const anchor = buildAnchor();
    if (anchor === null) return;
    if (description.trim() === "") {
      setError("Add a short note about the moment");
      return;
    }
    setError(null);
    const input: FlagInput = {
      ...anchor,
      category,
      description: description.trim(),
    };
    startTransition(async () => {
      const res = editing
        ? await updateFlaggedMoment(editing.id, input)
        : await createFlaggedMoment(documentId, input);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong — try again.");
        return;
      }
      router.refresh();
      onClose();
    });
  };

  const timeField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    placeholder: string
  ) => (
    <div className="flex flex-col gap-1">
      <label className="text-2xs uppercase tracking-wider text-ink-4">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-7 w-20 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
        />
        {getCurrentTime && (
          <button
            type="button"
            onClick={() => syncToPlayer(setValue)}
            title="Set to current player time"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">
              Set {label.toLowerCase()} to current player time
            </span>
          </button>
        )}
      </div>
    </div>
  );

  const HEADING: Record<FlagAnchorKind, string> = {
    time: "Flag this moment",
    page: "Flag a page",
    quote: "Flag selection",
    document: "Flag this document",
  };

  return (
    <div className="rounded-lg border border-line bg-paper-2 p-3">
      <div className="mb-2 text-xs font-semibold text-ink">
        {editing ? "Edit flag" : HEADING[kind]}
      </div>

      {kind === "quote" && (
        <div className="mb-2 flex flex-col gap-1">
          <label
            htmlFor={`flag-quote-${documentId}`}
            className="text-2xs uppercase tracking-wider text-ink-4"
          >
            Quoted text
          </label>
          <textarea
            id={`flag-quote-${documentId}`}
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            maxLength={MAX_QUOTE_CHARS}
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-white p-2 text-xs italic text-ink-2 focus:border-brand-300 focus:outline-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {kind === "time" && (
          <>
            {timeField("Time", timeText, setTimeText, "0:00")}
            {timeField("Span end (optional)", endText, setEndText, "—")}
          </>
        )}
        {kind === "page" && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`flag-page-${documentId}`}
              className="text-2xs uppercase tracking-wider text-ink-4"
            >
              {editing ? "Page" : "Page (blank = whole document)"}
            </label>
            <input
              id={`flag-page-${documentId}`}
              type="text"
              inputMode="numeric"
              value={pageText}
              onChange={(e) => setPageText(e.target.value)}
              placeholder="—"
              className="h-7 w-20 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`flag-category-${documentId}`}
            className="text-2xs uppercase tracking-wider text-ink-4"
          >
            Category
          </label>
          <select
            id={`flag-category-${documentId}`}
            value={category}
            onChange={(e) => setCategory(e.target.value as FlagCategory)}
            className="h-7 rounded-md border border-line bg-white px-2 text-xs text-ink focus:border-brand-300 focus:outline-none"
          >
            {FLAG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FLAG_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder={
          kind === "document"
            ? "Why does this document matter?"
            : "What happens at this moment?"
        }
        className="mt-2 w-full resize-y rounded-md border border-line bg-white p-2 text-xs text-ink placeholder:text-ink-4 focus:border-brand-300 focus:outline-none"
      />
      {error && <div className="mt-1 text-2xs text-warn">{error}</div>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex h-7 items-center rounded-md bg-brand-500 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Add flag"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex h-7 items-center rounded-md border border-line bg-white px-3 text-xs text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
