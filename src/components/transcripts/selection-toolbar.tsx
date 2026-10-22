/**
 * SelectionToolbar — a small floating bar over a text selection inside
 * the transcript: "Flag selection" (when the user can create flags),
 * "Copy with timecode", and "Change speaker" (transcript editors).
 *
 * `selectionToSpan` is the pure core: it reads the word spans
 * (`data-s` / `data-e`) the selection touches, so a selection across
 * paragraphs becomes ONE span from the first word's start to the last
 * word's end, with the selected words as the quote.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Flag, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** First / last selected word (paragraph id + word index), when the
   *  words sit in paragraphs (`data-seg` + `data-i`). */
  start?: { segmentId: string; word: number };
  end?: { segmentId: string; word: number };
};

function wordPoint(el: HTMLElement) {
  const segmentId = el.closest<HTMLElement>("[data-seg]")?.dataset.seg;
  const word = Number(el.dataset.i);
  return segmentId && Number.isInteger(word) ? { segmentId, word } : undefined;
}

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
  const start = wordPoint(words[0]);
  const end = wordPoint(words[words.length - 1]);
  return { startSeconds, endSeconds, quote, ...(start && end ? { start, end } : {}) };
}

type Shown = { span: SelectionSpan; left: number; top: number };

export function SelectionToolbar({
  rootRef,
  documentName,
  canFlag,
  onFlag,
  speakers,
  newSpeakerLabel,
  onChangeSpeaker,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  documentName: string;
  canFlag: boolean;
  onFlag: (span: SelectionSpan) => void;
  /** Speaker choices for "Change speaker"; omit to hide it (non-editors). */
  speakers?: { label: string; name: string }[];
  /** Label for "New speaker", or null when all 26 are used. */
  newSpeakerLabel?: string | null;
  onChangeSpeaker?: (span: SelectionSpan, speaker: string) => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  // While the speaker menu is open, clicks in its (portalled) popup must
  // not dismiss the bar along with the selection it acts on.
  const menuOpen = useRef(false);
  // Re-read the selection when the menu closes without a choice: the
  // transcript may have re-rendered under it.
  const recheck = useRef<() => void>(() => {});

  useEffect(() => {
    const onChange = () => {
      if (menuOpen.current) return;
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
    recheck.current = onChange;
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
      {speakers && onChangeSpeaker && span.start && span.end && (
        <DropdownMenu
          onOpenChange={(open) => {
            menuOpen.current = open;
            if (!open) recheck.current();
          }}
        >
          <DropdownMenuTrigger
            render={
              <button type="button" className={btn}>
                <UserRound className="h-3.5 w-3.5" aria-hidden />
                Change speaker
                <ChevronDown className="h-3 w-3" aria-hidden />
              </button>
            }
          />
          <DropdownMenuContent
            align="start"
            className="min-w-44"
            onMouseDown={(e) => e.preventDefault()}
          >
            {speakers.map((s) => (
              <DropdownMenuItem
                key={s.label}
                onClick={() => {
                  menuOpen.current = false;
                  onChangeSpeaker(span, s.label);
                  clear();
                }}
              >
                {s.name}
              </DropdownMenuItem>
            ))}
            {newSpeakerLabel && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    menuOpen.current = false;
                    onChangeSpeaker(span, newSpeakerLabel);
                    clear();
                  }}
                >
                  New speaker
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
