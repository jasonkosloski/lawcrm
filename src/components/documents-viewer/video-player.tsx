/**
 * Inline video renderer for discovery media (bodycam, dashcam).
 * `preload="metadata"` + the download route's Range support means
 * opening a multi-GB file costs a header read, and seeking pulls
 * only the requested slice. Server-renderable.
 */

export function VideoPlayer({ src }: { src: string }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-black/95 p-2">
      {/* Captions arrive with the transcript follow-up (see
          FEATURES.md); discovery media has none at upload time. */}
      <video
        src={src}
        controls
        preload="metadata"
        className="max-h-full w-full rounded"
      />
    </div>
  );
}
