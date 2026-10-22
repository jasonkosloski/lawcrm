/**
 * Inline flag composer — create + edit in one form, for every
 * anchor kind:
 *
 *   time  — mm:ss start (+ optional span end), prefilled from the
 *           player's currentTime; "set to current time" clock
 *           buttons when the parent supplies `getCurrentTime`
 *   page  — a page-number input, prefilled with the PDF viewer's
 *           current page (blank on create = flag the whole document),
 *           plus the quoted text when the flag came from a selection
 *   quote — the captured selection, editable (trim + 500 cap happens
 *           server-side too)
 *   document — no anchor fields, just category + note
 *
 * Create mode gets its anchor from the renderer adapter
 * (`createAnchor`); edit mode derives the kind from the flag row
 * itself (`flagAnchorKind`) — the server rejects kind switches, so
 * the form never offers one. Submit goes straight to the server
 * action, which revalidates the viewer and Evidence paths: the
 * action response already carries the re-rendered route, so the
 * composer does NOT also router.refresh() (that would render the
 * viewer — and re-read/convert the document — a second time).
 *
 * A fresh `createAnchor` object while the composer stays open (the
 * reviewer re-selects a different passage and hits "Flag selection"
 * again, or switches from "Flag document" to a selection) re-seeds
 * the anchor fields from the new capture; the note and category the
 * reviewer already typed are kept.
 *
 * Failures never reach the error boundary: validation and "flag
 * not found" come back as results, and a rejected action (network,
 * post-deploy "Failed to find Server Action") becomes an inline
 * message so the typed note survives. Next's own redirect/not-found
 * signals are re-thrown untouched.
 */

"use client";

import { useId, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { FLAG_NOT_FOUND } from "@/lib/flag-anchor";
import { formatMediaTime } from "@/lib/media-time";
import {
  MAX_QUOTE_CHARS,
  flagAnchorKind,
  type FlagAnchorKind,
} from "@/lib/flag-anchor";
import { buildFlagAnchor, type FlagAnchorText } from "./build-flag-anchor";
import { Button } from "@/components/ui/button";

export type ComposerFlag = {
  id: string;
  timeSeconds: number | null;
  endSeconds: number | null;
  pageNumber: number | null;
  endPageNumber: number | null;
  quote: string | null;
  category: string;
  description: string;
};

/** What the renderer adapter captured for a NEW flag. */
export type ComposerAnchor =
  | {
      kind: "time";
      timeSeconds: number;
      /** Span end, e.g. from a transcript selection. */
      endSeconds?: number;
      /** Transcript text the span covers; rides with the flag. */
      quote?: string;
    }
  | {
      kind: "page";
      pageNumber: number | null;
      /** Last page when the selection ran across pages. */
      endPageNumber?: number | null;
      /** Text selected on that page in the built-in PDF viewer. */
      quote?: string;
      hint?: string;
    }
  | {
      kind: "quote";
      quote: string;
      /** Optional heads-up shown under the quote (e.g. "this text
       *  appears 3 times — the flag will jump to the first"). */
      hint?: string;
    }
  | { kind: "document" };

/** Initial anchor-field text for an edit (from the row) or a create
 *  (from the adapter's capture). */
function seedAnchorText(
  editing: ComposerFlag | null,
  createAnchor: ComposerAnchor | null,
): FlagAnchorText {
  const kind: FlagAnchorKind = editing
    ? flagAnchorKind(editing)
    : (createAnchor?.kind ?? "document");
  const timeText =
    kind !== "time"
      ? ""
      : formatMediaTime(
          editing
            ? (editing.timeSeconds ?? 0)
            : createAnchor?.kind === "time"
              ? createAnchor.timeSeconds
              : 0,
        );
  const endText =
    editing?.endSeconds != null
      ? formatMediaTime(editing.endSeconds)
      : !editing && createAnchor?.kind === "time" && createAnchor.endSeconds != null
        ? formatMediaTime(createAnchor.endSeconds)
        : "";
  let pageText = "";
  if (editing?.pageNumber != null) pageText = String(editing.pageNumber);
  else if (!editing && createAnchor?.kind === "page" && createAnchor.pageNumber)
    pageText = String(createAnchor.pageNumber);
  let endPageText = "";
  if (editing?.endPageNumber != null) endPageText = String(editing.endPageNumber);
  else if (!editing && createAnchor?.kind === "page" && createAnchor.endPageNumber)
    endPageText = String(createAnchor.endPageNumber);
  const quoteText =
    editing?.quote ??
    (createAnchor?.kind === "quote" ||
    createAnchor?.kind === "page" ||
    createAnchor?.kind === "time"
      ? (createAnchor.quote ?? "")
      : "");
  return { timeText, endText, pageText, endPageText, quoteText };
}

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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Per-instance ids: a create composer (ReviewPanel) and an inline
  // edit composer (MomentsRail) can be open at once on one document.
  const uid = useId();

  const kind: FlagAnchorKind = editing
    ? flagAnchorKind(editing)
    : (createAnchor?.kind ?? "document");

  const [fields, setFields] = useState<FlagAnchorText>(() =>
    seedAnchorText(editing, createAnchor),
  );
  const [category, setCategory] = useState<FlagCategory>(
    editing && (FLAG_CATEGORIES as readonly string[]).includes(editing.category)
      ? (editing.category as FlagCategory)
      : "emphasis",
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  // A new capture while the composer is open re-seeds the anchor
  // fields (stored-previous-prop pattern — adjusting state during
  // render, not in an effect). Keyed on the capture object's
  // identity: adapters create a fresh object per capture.
  const [seenAnchor, setSeenAnchor] = useState(createAnchor);
  if (!editing && createAnchor !== seenAnchor) {
    setSeenAnchor(createAnchor);
    setFields(seedAnchorText(null, createAnchor));
    setError(null);
  }

  const setField = (key: keyof FlagAnchorText, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  const syncToPlayer = (key: "timeText" | "endText") => {
    const t = getCurrentTime?.();
    if (t !== null && t !== undefined) setField(key, formatMediaTime(t));
  };

  const submit = () => {
    const built = buildFlagAnchor(kind, fields, editing !== null);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    if (description.trim() === "") {
      setError("Add a short note about the moment");
      return;
    }
    setError(null);
    const input: FlagInput = {
      ...built.anchor,
      category,
      description: description.trim(),
    };
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof createFlaggedMoment>>;
      try {
        res = editing
          ? await updateFlaggedMoment(editing.id, input)
          : await createFlaggedMoment(documentId, input);
      } catch (err) {
        unstable_rethrow(err); // redirects / not-found are not failures
        console.error("Flag save failed", err);
        setError(
          "Couldn't save the flag — check your connection and try again.",
        );
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Something went wrong — try again.");
        // The flag is already gone: the action had nothing to
        // revalidate, so re-read the route to drop the stale row.
        if (res.error === FLAG_NOT_FOUND) router.refresh();
        return;
      }
      onClose();
    });
  };

  const timeField = (
    key: "timeText" | "endText",
    label: string,
    placeholder: string,
  ) => {
    const id = `${uid}-${key}`;
    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={id}
          className="text-2xs font-medium text-ink-3"
        >
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            value={fields[key]}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={placeholder}
            className="h-7 w-20 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
          />
          {getCurrentTime && (
            <button
              type="button"
              onClick={() => syncToPlayer(key)}
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
  };

  const HEADING: Record<FlagAnchorKind, string> = {
    time: "Flag this moment",
    page: "Flag a page",
    quote: "Flag selection",
    document: "Flag this document",
  };

  const quoteHint =
    !editing && (createAnchor?.kind === "quote" || createAnchor?.kind === "page")
      ? createAnchor.hint
      : undefined;
  // PDF flags show the quote box only when they carry a passage (a
  // selection, or an existing flag's quote) — page-only flags stay
  // page-only.
  const showQuote =
    kind === "quote" ||
    (kind === "time" &&
      (editing ? editing.quote != null : createAnchor?.kind === "time" && !!createAnchor.quote)) ||
    (kind === "page" &&
      (editing ? editing.quote != null : createAnchor?.kind === "page" && !!createAnchor.quote));

  return (
    <div className="rounded-lg border border-line bg-paper-2 p-3">
      <div className="mb-2 text-xs font-semibold text-ink">
        {editing ? "Edit flag" : showQuote ? HEADING.quote : HEADING[kind]}
      </div>

      {showQuote && (
        <div className="mb-2 flex flex-col gap-1">
          <label
            htmlFor={`${uid}-quote`}
            className="text-2xs font-medium text-ink-3"
          >
            Quoted text
          </label>
          <textarea
            id={`${uid}-quote`}
            value={fields.quoteText}
            onChange={(e) => setField("quoteText", e.target.value)}
            maxLength={MAX_QUOTE_CHARS}
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-white p-2 text-xs italic text-ink-2 focus:border-brand-300 focus:outline-none"
          />
          {quoteHint && (
            <div role="status" className="text-2xs text-warn">
              {quoteHint}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {kind === "time" && (
          <>
            {timeField("timeText", "Time", "0:00")}
            {timeField("endText", "Span end (optional)", "—")}
          </>
        )}
        {kind === "page" && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${uid}-page`}
              className="text-2xs font-medium text-ink-3"
            >
              {editing ? "Page" : "Page (blank = whole document)"}
            </label>
            <input
              id={`${uid}-page`}
              type="text"
              inputMode="numeric"
              value={fields.pageText}
              onChange={(e) => setField("pageText", e.target.value)}
              placeholder="—"
              className="h-7 w-20 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
            />
          </div>
        )}
        {kind === "page" && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${uid}-end-page`}
              className="text-2xs font-medium text-ink-3"
            >
              To page (optional)
            </label>
            <input
              id={`${uid}-end-page`}
              type="text"
              inputMode="numeric"
              value={fields.endPageText ?? ""}
              onChange={(e) => setField("endPageText", e.target.value)}
              placeholder="—"
              className="h-7 w-20 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${uid}-category`}
            className="text-2xs font-medium text-ink-3"
          >
            Category
          </label>
          <NativeSelect
            id={`${uid}-category`}
            value={category}
            onChange={(e) => setCategory(e.target.value as FlagCategory)}
            size="sm"
          >
            {FLAG_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {FLAG_CATEGORY_LABEL[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={2}
        aria-label="Note"
        placeholder={
          kind === "document"
            ? "Why does this document matter?"
            : "What happens at this moment?"
        }
        className="mt-2 w-full resize-y rounded-md border border-line bg-white p-2 text-xs text-ink placeholder:text-ink-4 focus:border-brand-300 focus:outline-none"
      />
      {error && (
        <div role="alert" className="mt-1 text-2xs text-warn">
          {error}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="xs"
          type="button"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Add flag"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          type="button"
          onClick={onClose}
          disabled={pending}
          className="hover:border-brand-300 hover:text-brand-700"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
