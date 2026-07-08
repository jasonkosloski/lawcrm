/**
 * Inline video renderer for discovery media (bodycam, dashcam).
 * `preload="metadata"` + the download route's Range support means
 * opening a multi-GB file costs a header read, and seeking pulls
 * only the requested slice. Server-renderable when no `mediaRef`
 * is passed; the evidence-review wrapper (`MediaReview`) renders it
 * client-side and plumbs a ref so flagging can read `currentTime`
 * and the moments rail can seek.
 */

import type { Ref } from "react";

export function VideoPlayer({
  src,
  mediaRef,
}: {
  src: string;
  /** Optional handle on the underlying <video> — the review wrapper
   *  reads currentTime (flag capture) and writes it (rail seeks). */
  mediaRef?: Ref<HTMLVideoElement>;
}) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-black/95 p-2">
      {/* Captions arrive with the transcript follow-up (see
          FEATURES.md); discovery media has none at upload time. */}
      <video
        ref={mediaRef}
        src={src}
        controls
        preload="metadata"
        className="max-h-full w-full rounded"
      />
    </div>
  );
}
