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
import { MoreHorizontal } from "lucide-react";
import { deleteTranscript } from "@/app/actions/transcripts";
import { confirmAction, notifyError } from "@/lib/feedback";
import type { TranscriptView } from "@/lib/queries/transcript";
import { activeWordIndex } from "@/lib/transcription/timecode";
import { FindBar } from "./find-bar";
import {
  TranscriptSegmentView,
  type SegmentDecor,
  type SegmentFind,
} from "./transcript-segment";
import {
  FailedBanner,
  InFlightNotice,
  TranscribeButton,
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
  canDelete,
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
  canDelete: boolean;
  /** The media's length, for the Transcribe button. */
  durationSeconds: number | null;
  /** From ?t=: scroll the pane here once. */
  initialSeconds?: number | null;
  onFlagFocus?: (flagId: string) => void;
  /** Task 8 adds `canEdit` here (edit mode, speaker chips). */
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
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
    for (const seg of segments) {
      const words = seg.words;
      let d: SegmentDecor | undefined;
      const ensure = (): SegmentDecor => (d ??= { tints: new Array(words.length).fill(null), markers: {} });
      for (const f of flags) {
        if (f.timeSeconds === null) continue;
        if (f.endSeconds !== null && f.endSeconds > f.timeSeconds) {
          if (seg.endSeconds <= f.timeSeconds || seg.startSeconds >= f.endSeconds) continue;
          words.forEach((w, i) => {
            if (w.s < f.endSeconds! && w.e > f.timeSeconds!) ensure().tints[i] = f.category;
          });
        } else if (words.length > 0) {
          const first = words[0].s;
          const last = words[words.length - 1].e;
          if (f.timeSeconds < first - 5 || f.timeSeconds > last + 5) continue;
          // Nearest word start (the point may land between words).
          let best = 0;
          for (let i = 1; i < words.length; i++) {
            if (Math.abs(words[i].s - f.timeSeconds) < Math.abs(words[best].s - f.timeSeconds)) best = i;
          }
          const m = ensure().markers;
          (m[best] ??= []).push(f.id);
        }
      }
      if (d) out.set(seg.id, d);
    }
    return out;
  }, [segments, flags]);

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
    if (el) scrollToEl(scrollRef.current!, el);
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
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box && el) scrollToEl(box, el);
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
    if (el) scrollToEl(box, el);
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
    setMenuOpen(false);
    const ok = await confirmAction({
      title: "Delete this transcript?",
      description:
        "The transcript and any corrections to it are removed for good. The recording is not affected.",
      confirmLabel: "Delete transcript",
      destructive: true,
    });
    if (!ok) return;
    const res = await deleteTranscript(documentId);
    if (!res.ok) {
      notifyError(res.error ?? "Couldn't delete the transcript.");
      return;
    }
    router.refresh();
  };

  // ── Render ──
  if (!transcript) {
    return canTranscribe ? (
      <TranscribeButton documentId={documentId} durationSeconds={durationSeconds} />
    ) : null;
  }

  const hasText = !!segments && segments.length > 0;
  const showMenu =
    (canDelete || (canTranscribe && !inFlight)) && (status === "completed" || status === "failed");

  return (
    <section
      aria-label={`Transcript of ${documentName}`}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {inFlight && <InFlightNotice />}
      {status === "failed" && (
        <FailedBanner documentId={documentId} error={transcript.error} canTranscribe={canTranscribe} />
      )}

      {(hasText || status === "completed") && (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-ink-2">Transcript</h2>
            {transcript.correctedAt && (
              <span className="text-2xs text-ink-3">
                Corrected{transcript.correctedByName ? ` by ${transcript.correctedByName}` : ""}
              </span>
            )}
            <div className="relative ml-auto flex items-center gap-1">
              {hasText && (
                <button
                  type="button"
                  onClick={() => setFindOpen(true)}
                  className="h-6 rounded-md px-2 text-2xs font-medium text-ink-3 hover:text-ink"
                >
                  Find
                </button>
              )}
              {showMenu && (
                <>
                  <button
                    type="button"
                    aria-label="Transcript options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:text-ink"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-7 z-20 flex w-44 flex-col rounded-md border border-line bg-white p-1 text-xs shadow-md"
                    >
                      {canTranscribe && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={retranscribing}
                          onClick={() => {
                            setMenuOpen(false);
                            void retranscribe();
                          }}
                          className="rounded px-2 py-1.5 text-left hover:bg-paper-2"
                        >
                          Re-transcribe
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={remove}
                          className="rounded px-2 py-1.5 text-left text-warn hover:bg-paper-2"
                        >
                          Delete transcript
                        </button>
                      )}
                    </div>
                  )}
                </>
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
              />
            ))}
          </div>
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

/** Center `el` in `box` without scrolling the page. */
function scrollToEl(box: HTMLElement, el: HTMLElement) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top >= b.top + 24 && r.bottom <= b.bottom - 24) return;
  box.scrollTo?.({ top: box.scrollTop + (r.top - b.top) - b.height / 2, behavior: "smooth" });
}
