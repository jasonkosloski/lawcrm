/**
 * Inline audio renderer in a wide-timeline layout — 911 calls and
 * bodycam audio run 20–60+ minutes, so the scrubber gets the full
 * row width and a playback-rate control (1× / 1.25× / 1.5× / 2×)
 * sits alongside for review listening.
 *
 * Rate is applied straight to the <audio> element; changing it
 * mid-playback is seamless (no reload, Range streaming continues).
 */

"use client";

import { useRef, useState } from "react";
import { AudioLines } from "lucide-react";

const RATES = [1, 1.25, 1.5, 2] as const;

/** Apply an element to a caller-supplied ref (function or object).
 *  Module-level so the component body never mutates its own props —
 *  the react-hooks immutability rule (rightly) flags that pattern. */
function assignRef<T>(ref: React.Ref<T> | undefined, el: T | null): void {
  if (typeof ref === "function") ref(el);
  else if (ref) (ref as React.RefObject<T | null>).current = el;
}

export function AudioPlayer({
  src,
  name,
  mediaRef,
}: {
  src: string;
  name: string;
  /** Optional handle on the underlying <audio> — the evidence-review
   *  wrapper (`MediaReview`) reads currentTime (flag capture) and
   *  writes it (rail seeks). Kept separate from the internal
   *  playback-rate ref via a merging callback ref. */
  mediaRef?: React.Ref<HTMLAudioElement>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState<number>(1);

  // Merge the internal rate-control ref with the optional external one.
  const setRefs = (el: HTMLAudioElement | null) => {
    audioRef.current = el;
    assignRef(mediaRef, el);
  };

  const applyRate = (r: number) => {
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  return (
    <div className="flex flex-1 items-start justify-center pt-10">
      <div className="flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-line bg-paper-2 p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <AudioLines className="h-4 w-4 text-ink-3" aria-hidden />
          <span className="truncate">{name}</span>
        </div>
        {/* Transcript support is a queued follow-up (FEATURES.md);
            recordings have no caption track at upload time. */}
        <audio
          ref={setRefs}
          src={src}
          controls
          preload="metadata"
          className="w-full"
          // Re-assert the chosen rate when playback (re)starts —
          // some browsers reset playbackRate on load.
          onPlay={() => {
            if (audioRef.current) audioRef.current.playbackRate = rate;
          }}
        />
        <div className="flex items-center gap-1">
          <span className="mr-1 text-2xs uppercase tracking-wider text-ink-4">
            Speed
          </span>
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => applyRate(r)}
              aria-pressed={rate === r}
              className={
                rate === r
                  ? "rounded-md border border-brand-200 bg-brand-soft px-2 py-1 text-xs font-medium text-brand-700"
                  : "rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-3 hover:border-brand-300 hover:text-brand-700"
              }
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
