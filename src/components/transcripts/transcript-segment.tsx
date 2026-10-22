/**
 * One speaker paragraph. Memoized: the pane hands each segment a stable
 * `segment` object and an `activeIndex` that is non-null only for the
 * segment holding the playhead, so playback re-renders one paragraph.
 * Word spans stay plain `<span data-s data-e data-i>` (selection →
 * flag/copy reads them) and clicks are delegated to the paragraph.
 */

"use client";

import { memo } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { flagCategoryTintClass } from "@/lib/constants/flag-category";
import { formatTimecode } from "@/lib/transcription/timecode";
import type { TranscriptSegmentView as Segment } from "@/lib/queries/transcript";

/** Flag decoration for one segment, keyed by word index. */
export type SegmentDecor = {
  /** Flag category covering each word, or null. */
  tints: (string | null)[];
  /** Point-flag ids rendered as a marker before a word index. */
  markers: Record<number, string[]>;
};

export type SegmentFind = {
  /** Word indexes inside any match. */
  words: ReadonlySet<number>;
  /** Word indexes of the match the find bar is on, if it is in this segment. */
  current: ReadonlySet<number> | null;
};

export type TranscriptSegmentProps = {
  segment: Segment;
  speakerName: string;
  /** Word index at the playhead; null for every other segment. */
  activeIndex: number | null;
  decor?: SegmentDecor;
  find?: SegmentFind;
  onSeek: (seconds: number) => void;
  onMarkerClick?: (flagId: string) => void;
  // Task 8 adds an `editing` mode here (textarea + speaker chip).
};

export const TranscriptSegmentView = memo(function TranscriptSegmentView({
  segment,
  speakerName,
  activeIndex,
  decor,
  find,
  onSeek,
  onMarkerClick,
}: TranscriptSegmentProps) {
  const words = segment.words;

  const onClick = (e: React.MouseEvent<HTMLParagraphElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-s]");
    if (!el) return;
    // A drag-select ends in a click; don't yank the playhead for it.
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim() !== "") return;
    const s = Number(el.dataset.s);
    if (Number.isFinite(s)) onSeek(s);
  };

  return (
    <div data-seg={segment.id} className="py-2">
      <div className="mb-0.5 flex items-center gap-2 text-2xs">
        <span className="font-semibold text-ink-2">{speakerName}</span>
        <button
          type="button"
          onClick={() => onSeek(segment.startSeconds)}
          className="font-mono text-ink-3 hover:text-brand-700"
        >
          {`[${formatTimecode(segment.startSeconds)}]`}
        </button>
      </div>
      <p className="text-sm leading-relaxed text-ink" onClick={onClick}>
        {words.map((w, i) => {
          const tint = decor?.tints[i] ?? null;
          const marked = decor?.markers[i];
          const inFind = find?.words.has(i) ?? false;
          const isFindCurrent = find?.current?.has(i) ?? false;
          return (
            <span key={i}>
              {i > 0 ? " " : null}
              {marked?.map((flagId) => (
                <button
                  key={flagId}
                  type="button"
                  aria-label="Flagged moment"
                  data-flag-marker={flagId}
                  onClick={() => onMarkerClick?.(flagId)}
                  className="mr-0.5 inline-flex align-middle text-warn"
                >
                  <Flag className="h-3 w-3" aria-hidden />
                </button>
              ))}
              <span
                data-i={i}
                data-s={w.s}
                data-e={w.e}
                data-flag-category={tint ?? undefined}
                data-find={isFindCurrent ? "current" : inFind ? "match" : undefined}
                aria-current={activeIndex === i ? "true" : undefined}
                className={cn(
                  "cursor-pointer rounded-sm hover:bg-brand-50",
                  tint && flagCategoryTintClass(tint),
                  inFind && "bg-yellow-200 text-ink",
                  isFindCurrent && "bg-orange-300 text-ink",
                  activeIndex === i && "underline decoration-brand-500 decoration-2 underline-offset-2",
                )}
              >
                {w.w}
              </span>
            </span>
          );
        })}
      </p>
    </div>
  );
});
