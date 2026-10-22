/**
 * MediaTranscript — binds a TranscriptPane to the page's <video>/<audio>.
 * Owns the playhead clock so only the pane re-renders while playing
 * (the flags rail and player don't): `timeupdate` + seeks, plus a
 * requestAnimationFrame loop while playing for word-level precision.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { TranscriptPane, type PaneFlag } from "./transcript-pane";
import type { SelectionSpan } from "./selection-toolbar";
import type { TranscriptView } from "@/lib/queries/transcript";

export function MediaTranscript({
  mediaRef,
  transcript,
  documentId,
  documentName,
  flags,
  canTranscribe,
  canDelete,
  canEdit,
  canFlag,
  onFlagSelection,
  initialSeconds,
}: {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  transcript: TranscriptView | null;
  documentId: string;
  documentName: string;
  flags: PaneFlag[];
  canTranscribe: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canFlag: boolean;
  onFlagSelection: (span: SelectionSpan) => void;
  initialSeconds: number | null;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => setCurrentTime(el.currentTime);
    const loop = () => {
      sync();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      cancelAnimationFrame(raf);
      sync();
    };
    const onMeta = () =>
      setDuration(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.addEventListener("timeupdate", sync);
    el.addEventListener("seeked", sync);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    // Metadata may have landed before hydration.
    const init = requestAnimationFrame(() => {
      onMeta();
      sync();
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(init);
      el.removeEventListener("timeupdate", sync);
      el.removeEventListener("seeked", sync);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
    };
  }, [mediaRef]);

  const onSeek = useCallback(
    (s: number) => {
      const el = mediaRef.current;
      if (!el) return;
      el.currentTime = s;
      setCurrentTime(s);
    },
    [mediaRef],
  );

  return (
    <TranscriptPane
      transcript={transcript}
      documentId={documentId}
      documentName={documentName}
      currentTime={currentTime}
      onSeek={onSeek}
      flags={flags}
      canTranscribe={canTranscribe}
      canDelete={canDelete}
      canEdit={canEdit}
      canFlag={canFlag}
      onFlagSelection={onFlagSelection}
      durationSeconds={duration}
      initialSeconds={initialSeconds}
    />
  );
}
