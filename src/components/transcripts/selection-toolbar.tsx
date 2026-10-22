/**
 * SelectionToolbar — a small floating bar over a text selection inside
 * the transcript: "Flag selection" (when the user can create flags) and
 * "Copy with timecode".
 *
 * `selectionToSpan` is the pure core: it reads the word spans
 * (`data-s` / `data-e`) the selection touches, so a selection across
 * paragraphs becomes ONE span from the first word's start to the last
 * word's end, with the selected words as the quote.
 */

"use client";

import { useEffect, useState } from "react";
import { Copy, Flag } from "lucide-react";
import { notifyError, notifySuccess } from "@/lib/feedback";
import { formatShortTimecode } from "@/lib/transcription/timecode";

/**
 * The composer edits whole seconds, so widen the selection to whole seconds
 * that still cover it (a sub-second selection becomes a one-second span).
 */
export function spanToComposerAnchor(span: SelectionSpan) {
  const timeSeconds = Math.floor(span.startSeconds);
  return {
    kind: "time" as const,
    timeSeconds,
    endSeconds: Math.max(Math.ceil(span.endSeconds), timeSeconds + 1),
    quote: span.quote,
  };
}

export type SelectionSpan = {
  startSeconds: number;
  endSeconds: number;
  quote: string;
};

export function selectionToSpan(
  selection: Selection,
  root: HTMLElement,
): SelectionSpan | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const words: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-s][data-e]")) {
    if (!range.intersectsNode(el)) continue;
    // A boundary that only touches a word's edge doesn't select it.
    const text = el.firstChild;
    if (text && range.startContainer === text && range.startOffset >= (text.textContent?.length ?? 0)) continue;
    if (text && range.endContainer === text && range.endOffset === 0) continue;
    words.push(el);
  }
  if (words.length === 0) return null;
  const startSeconds = Number(words[0].dataset.s);
  const endSeconds = Number(words[words.length - 1].dataset.e);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
  const quote = words.map((w) => (w.textContent ?? "").trim()).join(" ");
  return { startSeconds, endSeconds, quote };
}

type Shown = { span: SelectionSpan; left: number; top: number };

export function SelectionToolbar({
  rootRef,
  documentName,
  canFlag,
  onFlag,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  documentName: string;
  canFlag: boolean;
  onFlag: (span: SelectionSpan) => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    const onChange = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      const span = root && sel ? selectionToSpan(sel, root) : null;
      if (!span || !sel) {
        setShown(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setShown({
        span,
        left: Math.max(8, rect.left + rect.width / 2),
        top: Math.max(8, rect.top - 40),
      });
    };
    // The bar is position:fixed, so follow the selection as anything scrolls
    // (capture catches the pane's own scroll); hide it when scrolled out of view.
    const onScroll = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const box = root.getBoundingClientRect();
      if (rect.height > 0 && (rect.bottom < box.top || rect.top > box.bottom)) {
        setShown(null);
        return;
      }
      setShown((cur) =>
        cur
          ? { ...cur, left: Math.max(8, rect.left + rect.width / 2), top: Math.max(8, rect.top - 40) }
          : cur,
      );
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [rootRef]);

  if (!shown) return null;
  const { span } = shown;

  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setShown(null);
  };

  const copy = async () => {
    const text = `"${span.quote}" (${documentName} at ${formatShortTimecode(span.startSeconds)})`;
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess("Copied with timecode");
    } catch {
      notifyError("Couldn't copy. Select the text and copy it directly.");
    }
    clear();
  };

  const btn =
    "inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-ink-2 hover:bg-paper-2 hover:text-brand-700";

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: shown.left, top: shown.top }}
      // Keep the text selected while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-line bg-white p-0.5 shadow-md"
    >
      {canFlag && (
        <button
          type="button"
          className={btn}
          onClick={() => {
            onFlag(span);
            clear();
          }}
        >
          <Flag className="h-3.5 w-3.5" aria-hidden />
          Flag selection
        </button>
      )}
      <button type="button" className={btn} onClick={copy}>
        <Copy className="h-3.5 w-3.5" aria-hidden />
        Copy with timecode
      </button>
    </div>
  );
}
