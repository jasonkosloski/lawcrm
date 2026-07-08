/**
 * MediaReview — the ReviewPanel adapter for video/audio renderers.
 *
 * Supplies the two adapter halves:
 *   capture — "Flag this moment" reads the player's `currentTime`
 *             via a ref plumbed into VideoPlayer / AudioPlayer;
 *   navigate — clicking a time-anchored flag writes `currentTime`
 *              (seek to the flag's start).
 *
 * Also honors the page's deep links (`?t=SECONDS` and a `?flag=`
 * resolved server-side to `initialSeconds`) by seeking once the
 * media's metadata is available — currentTime writes before
 * `loadedmetadata` are dropped by some browsers.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { VideoPlayer } from "@/components/documents-viewer/video-player";
import { AudioPlayer } from "@/components/documents-viewer/audio-player";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

export function MediaReview({
  kind,
  src,
  name,
  documentId,
  initialSeconds,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
}: {
  kind: "video" | "audio";
  src: string;
  name: string;
  documentId: string;
  /** From the page's ?t= / ?flag= params — null when absent/invalid. */
  initialSeconds: number | null;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(
    null
  );

  // Deep-link seek — once metadata is in (readyState 0 drops
  // currentTime writes in some browsers). Runs once per mount; the
  // rail's later seeks go straight to the element.
  useEffect(() => {
    if (initialSeconds === null) return;
    const el = mediaRef.current;
    if (!el) return;
    const seek = () => {
      el.currentTime = initialSeconds;
    };
    if (el.readyState >= 1) {
      seek();
      return;
    }
    el.addEventListener("loadedmetadata", seek, { once: true });
    return () => el.removeEventListener("loadedmetadata", seek);
  }, [initialSeconds]);

  const getCurrentTime = (): number | null => {
    const el = mediaRef.current;
    return el ? el.currentTime : null;
  };

  const navigate = (m: RailMoment) => {
    const el = mediaRef.current;
    if (!el || m.timeSeconds === null) return;
    el.currentTime = m.timeSeconds;
  };

  return (
    <ReviewPanel
      documentId={documentId}
      moments={moments}
      currentUserId={currentUserId}
      canCreate={canCreate}
      canEditAny={canEditAny}
      canDeleteAny={canDeleteAny}
      captureLabel="Flag this moment"
      captureAnchor={() => ({
        kind: "time",
        timeSeconds: getCurrentTime() ?? 0,
      })}
      composerAnchor={composerAnchor}
      onComposerAnchorChange={setComposerAnchor}
      onNavigate={navigate}
      getCurrentTime={getCurrentTime}
      emptyHint="Scrub to a key moment and hit “Flag this moment.”"
    >
      {kind === "video" ? (
        <VideoPlayer
          src={src}
          mediaRef={mediaRef as React.Ref<HTMLVideoElement>}
        />
      ) : (
        <AudioPlayer
          src={src}
          name={name}
          mediaRef={mediaRef as React.Ref<HTMLAudioElement>}
        />
      )}
    </ReviewPanel>
  );
}
