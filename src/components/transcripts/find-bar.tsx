/** Find-in-transcript bar: query, "n of m", prev/next, close. */

"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

export function FindBar({
  query,
  onQueryChange,
  total,
  current,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  total: number;
  /** 0-based index of the active match. */
  current: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1">
      <input
        ref={ref}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label="Find in transcript"
        placeholder="Find in transcript"
        className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
      />
      <span className="font-mono text-2xs text-ink-3" aria-live="polite">
        {query.trim() === "" ? "" : total === 0 ? "No matches" : `${current + 1} of ${total}`}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        onClick={onPrev}
        disabled={total === 0}
        className="text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Next match"
        onClick={onNext}
        disabled={total === 0}
        className="text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="text-ink-3 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
