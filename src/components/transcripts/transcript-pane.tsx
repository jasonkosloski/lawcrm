/**
 * TranscriptPane — the working surface for a recording's transcript.
 *
 * Sync: `currentTime` marks the active word (only in the segment that
 * holds the playhead, so memoized segments skip everything else). Follow
 * mode keeps that word in view; a manual wheel/touch scroll pauses it
 * until "Resume following". Click a word or timecode to seek. Flags tint
 * the words they cover (point flags get a marker). Cmd/Ctrl+F opens a
 * find bar that counts, cycles and seeks matches.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, MoreHorizontal, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTranscript } from "@/app/actions/transcripts";
import { confirmAction, notifyError } from "@/lib/feedback";
import type { TranscriptView } from "@/lib/queries/transcript";
import { activeWordIndex } from "@/lib/transcription/timecode";
import { FindBar } from "./find-bar";
import { SelectionToolbar, type SelectionSpan } from "./selection-toolbar";
import {
  TranscriptSegmentView,
  type SegmentDecor,
  type SegmentFind,
} from "./transcript-segment";
import {
  FailedBanner,
  InFlightNotice,
  TranscribeButton,
  TranscribeUnavailable,
  useRequestTranscript,
} from "./transcript-status";

export type PaneFlag = {
  id: string;
  timeSeconds: number | null;
  endSeconds: number | null;
  category: string;
};

const POLL_MS = 15_000;

export function TranscriptPane({
  transcript,
  documentId,
  documentName,
  currentTime,
  onSeek,
  flags,
  canTranscribe,
  transcriptionConfigured = true,
  canDelete,
  canEdit = false,
  canFlag = false,
  onFlagSelection,
  durationSeconds,
  initialSeconds = null,
  onFlagFocus,
}: {
  transcript: TranscriptView | null;
  documentId: string;
  documentName: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
  flags: PaneFlag[];
  canTranscribe: boolean;
  /** False when no provider key is set: Transcribe is shown disabled. */
  transcriptionConfigured?: boolean;
  canDelete: boolean;
  /** The media's length, for the Transcribe button. */
  durationSeconds: number | null;
  /** From ?t=: scroll the pane here once. */
  initialSeconds?: number | null;
  onFlagFocus?: (flagId: string) => void;
  /** May correct text and speakers (documents.transcript.edit). */
  canEdit?: boolean;
  /** May create flags: shows "Flag selection". */
  canFlag?: boolean;
  /** Open the flag composer on a selected span. */
  onFlagSelection?: (span: SelectionSpan) => void;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Until this time a scroll event is ours (follow/find/deep link), not the user's.
  const ownScrollUntil = useRef(0);
  const [following, setFollowing] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const { run: retranscribe, pending: retranscribing } =
    useRequestTranscript(documentId);

  const status = transcript?.status ?? null;
  const segments = transcript?.segments;
  const inFlight = status === "queued" || status === "processing";

  // Poll while a job is running; the webhook flips the row.
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, router]);

  // ── Highlights from flags (recomputed only when flags/segments change) ──
  const decor = useMemo(() => {
    const out = new Map<string, SegmentDecor>();
    if (!segments) return out;
    const ensure = (seg: (typeof segments)[number]): SegmentDecor => {
      let d = out.get(seg.id);
      if (!d) {
        d = { tints: new Array(seg.words.length).fill(null), markers: {} };
        out.set(seg.id, d);
      }
      return d;
    };
    for (const f of flags) {
      if (f.timeSeconds === null) continue;
      const t = f.timeSeconds;
      if (f.endSeconds !== null && f.endSeconds > t) {
        for (const seg of segments) {
          if (seg.endSeconds <= t || seg.startSeconds >= f.endSeconds) continue;
          seg.words.forEach((w, i) => {
            if (w.s < f.endSeconds! && w.e > t) ensure(seg).tints[i] = f.category;
          });
        }
      } else {
        // A point flag marks the single nearest word across all paragraphs.
        let bestSeg: (typeof segments)[number] | null = null;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (const seg of segments) {
          if (seg.words.length === 0) continue;
          seg.words.forEach((w, i) => {
            const d = Math.abs(w.s - t);
            if (d < bestDist) {
              bestDist = d;
              bestSeg = seg;
              bestIdx = i;
            }
          });
        }
        if (bestSeg && bestDist <= 5) {
          const m = ensure(bestSeg).markers;
          (m[bestIdx] ??= []).push(f.id);
        }
      }
    }
    return out;
  }, [segments, flags]);

  // Speaker labels in use, so "New speaker" never reuses one.
  const usedSpeakers = useMemo(
    () => (segments ? [...new Set(segments.map((s) => s.speaker))] : []),
    [segments],
  );

  // ── Find ──
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { segId: string; words: number[]; start: number }[] = [];
    if (!q || !segments) return out;
    for (const seg of segments) {
      const offsets: number[] = [];
      let text = "";
      seg.words.forEach((w, i) => {
        if (i > 0) text += " ";
        offsets.push(text.length);
        text += w.w;
      });
      const hay = text.toLowerCase();
      let from = 0;
      for (;;) {
        const at = hay.indexOf(q, from);
        if (at < 0) break;
        const end = at + q.length;
        const idxs: number[] = [];
        seg.words.forEach((w, i) => {
          if (offsets[i] < end && offsets[i] + w.w.length > at) idxs.push(i);
        });
        if (idxs.length) out.push({ segId: seg.id, words: idxs, start: seg.words[idxs[0]].s });
        from = end;
      }
    }
    return out;
  }, [segments, query]);
  const current = matches.length ? Math.min(matchIdx, matches.length - 1) : 0;

  const finds = useMemo(() => {
    const out = new Map<string, SegmentFind>();
    matches.forEach((m, n) => {
      let f = out.get(m.segId);
      if (!f) {
        f = { words: new Set<number>(), current: null };
        out.set(m.segId, f);
      }
      m.words.forEach((i) => (f.words as Set<number>).add(i));
      if (n === current) f.current = new Set(m.words);
    });
    return out;
  }, [matches, current]);

  // Scroll the current match into view (and stop follow fighting it).
  useEffect(() => {
    if (!findOpen) return;
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-find="current"]');
    if (el) scrollToEl(scrollRef.current!, el, ownScrollUntil);
  }, [findOpen, current, matches]);

  const goToMatch = (n: number) => {
    if (matches.length === 0) return;
    const idx = (n + matches.length) % matches.length;
    setMatchIdx(idx);
    setFollowing(false);
    onSeek(matches[idx].start);
  };

  const closeFind = () => {
    setFindOpen(false);
    setQuery("");
    setMatchIdx(0);
  };

  // ── Playhead ──
  const activeSegId = useMemo(() => {
    if (!segments) return null;
    let found: string | null = null;
    for (const s of segments) {
      if (s.startSeconds <= currentTime) found = s.id;
      else break;
    }
    return found;
  }, [segments, currentTime]);

  // Follow: keep the active word in view.
  const activeKey = `${activeSegId}:${
    segments && activeSegId
      ? activeWordIndex(segments.find((s) => s.id === activeSegId)!.words, currentTime)
      : -1
  }`;
  useEffect(() => {
    if (!following || findOpen) return;
    const box = scrollRef.current;
    // Don't scroll under a selection in progress.
    if (box && hasSelectionIn(box)) return;
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box && el) scrollToEl(box, el, ownScrollUntil);
  }, [following, findOpen, activeKey]);

  // ?t= deep link: scroll once to that moment.
  useEffect(() => {
    if (initialSeconds === null || !segments?.length) return;
    const box = scrollRef.current;
    if (!box) return;
    let seg = segments[0];
    for (const s of segments) if (s.startSeconds <= initialSeconds) seg = s;
    const i = Math.max(0, activeWordIndex(seg.words, initialSeconds));
    const el = box.querySelector<HTMLElement>(`[data-seg="${seg.id}"] [data-i="${i}"]`);
    if (el) scrollToEl(box, el, ownScrollUntil);
    // Once per mount, like the media's own deep-link seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeconds, segments?.length]);

  const handleMarker = useCallback(
    (flagId: string) => {
      onFlagFocus?.(flagId);
      document.getElementById(`flag-${flagId}`)?.scrollIntoView?.({ block: "nearest" });
    },
    [onFlagFocus],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFindOpen(true);
    }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: "Delete this transcript?",
      description:
        "The transcript and any corrections to it are removed for good. The recording is not affected.",
      confirmLabel: "Delete transcript",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await deleteTranscript(documentId);
      if (!res.ok) {
        notifyError(res.error ?? "Couldn't delete the transcript.");
        return;
      }
      router.refresh();
    } catch {
      notifyError("Couldn't delete the transcript. Try again.");
    }
  };

  // ── Render ──
  if (!transcript) {
    if (!canTranscribe) return null;
    return transcriptionConfigured ? (
      <TranscribeButton documentId={documentId} durationSeconds={durationSeconds} />
    ) : (
      <TranscribeUnavailable />
    );
  }

  const hasText = !!segments && segments.length > 0;
  // Delete stays reachable for a failed or in-flight transcript with no text.
  // Re-running needs a provider key too.
  const canRun = canTranscribe && transcriptionConfigured;
  const showMenu = canDelete || (canRun && !inFlight);
  // Corrections only make sense on a finished transcript.
  const editing = editMode && status === "completed";

  return (
    <section
      aria-label={`Transcript of ${documentName}`}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {inFlight && <InFlightNotice />}
      {status === "failed" && (
        <FailedBanner documentId={documentId} error={transcript.error} canTranscribe={canRun} />
      )}

      {(hasText || status === "completed" || showMenu) && (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-ink-2">Transcript</h2>
            {transcript.correctedAt && (
              <span className="text-2xs text-ink-3">
                Corrected{transcript.correctedByName ? ` by ${transcript.correctedByName}` : ""}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {hasText && (
                <button
                  type="button"
                  onClick={() => setFindOpen(true)}
                  className="h-6 rounded-md px-2 text-2xs font-medium text-ink-3 hover:text-ink"
                >
                  Find
                </button>
              )}
              {status === "completed" && hasText && (
                <a
                  href={`/print/transcripts/${documentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-ink-3 hover:text-ink"
                >
                  <FileDown className="h-3 w-3" aria-hidden />
                  Export PDF
                </a>
              )}
              {canEdit && hasText && status === "completed" && (
                <button
                  type="button"
                  aria-label="Edit transcript"
                  aria-pressed={editMode}
                  onClick={() => setEditMode((v) => !v)}
                  className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium ${
                    editMode ? "bg-brand-50 text-brand-700" : "text-ink-3 hover:text-ink"
                  }`}
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                  {editMode ? "Done editing" : "Edit"}
                </button>
              )}
              {showMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Transcript options"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:text-ink"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="min-w-44">
                    {canRun && !inFlight && (
                      <DropdownMenuItem
                        disabled={retranscribing}
                        onClick={() => void retranscribe()}
                      >
                        Re-transcribe
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem variant="destructive" onClick={remove}>
                        Delete transcript
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {findOpen && (
            <FindBar
              query={query}
              onQueryChange={(q) => {
                setQuery(q);
                setMatchIdx(0);
              }}
              total={matches.length}
              current={current}
              onNext={() => goToMatch(current + 1)}
              onPrev={() => goToMatch(current - 1)}
              onClose={closeFind}
            />
          )}
        </>
      )}

      {status === "completed" && !hasText && (
        <p className="rounded-md border border-line bg-paper-2 px-3 py-4 text-sm text-ink-3">
          No speech detected
        </p>
      )}

      {hasText && (
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            tabIndex={-1}
            onWheel={() => setFollowing(false)}
            onTouchMove={() => setFollowing(false)}
            // The pane itself (not a word) is the target of a scrollbar drag.
            onPointerDown={(e) => e.target === e.currentTarget && setFollowing(false)}
            onKeyDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
              if (SCROLL_KEYS.has(e.key)) setFollowing(false);
            }}
            onScroll={() => {
              if (performance.now() > ownScrollUntil.current) setFollowing(false);
            }}
            className="relative max-h-[60vh] min-h-64 overflow-y-auto rounded-md border border-line bg-white px-3 py-1 outline-none"
          >
            {segments!.map((seg) => (
              <TranscriptSegmentView
                key={seg.id}
                segment={seg}
                speakerName={transcript.speakers[seg.speaker] ?? `Speaker ${seg.speaker}`}
                activeIndex={
                  seg.id === activeSegId ? activeWordIndex(seg.words, currentTime) : null
                }
                decor={decor.get(seg.id)}
                find={finds.get(seg.id)}
                onSeek={onSeek}
                onMarkerClick={handleMarker}
                transcriptId={transcript.id}
                speakers={transcript.speakers}
                usedSpeakers={usedSpeakers}
                canEdit={canEdit}
                editMode={editing}
              />
            ))}
          </div>
          <SelectionToolbar
            rootRef={scrollRef}
            documentName={documentName}
            canFlag={canFlag && !!onFlagSelection}
            onFlag={(span) => onFlagSelection?.(span)}
          />
          {!following && !findOpen && (
            <button
              type="button"
              onClick={() => setFollowing(true)}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink-2 shadow-md hover:text-brand-700"
            >
              Resume following
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const SCROLL_KEYS = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
]);

/** A non-collapsed selection that touches `box`. */
function hasSelectionIn(box: HTMLElement): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  return box.contains(sel.anchorNode) || box.contains(sel.focusNode);
}

/** Center `el` in `box` without scrolling the page; marks the scroll as ours. */
function scrollToEl(box: HTMLElement, el: HTMLElement, own: { current: number }) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top >= b.top + 24 && r.bottom <= b.bottom - 24) return;
  // Smooth scrolling fires events for a while; none of them are the user's.
  own.current = performance.now() + 1000;
  box.scrollTo?.({ top: box.scrollTop + (r.top - b.top) - b.height / 2, behavior: "smooth" });
}
