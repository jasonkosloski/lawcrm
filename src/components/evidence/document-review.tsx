/**
 * DocumentReview — the ReviewPanel adapter for renderers with no
 * inline anchor: images, legacy .doc, unsupported types, and any
 * preview that fell back to the download card. One affordance
 * ("Flag document", anchorless) and no navigation — rows in the
 * rail render as plain entries.
 *
 * Also the graceful home for anchored flags whose renderer can't
 * navigate anymore (e.g. a quote flag on a docx whose conversion
 * now fails): they still list, they just don't jump.
 */

"use client";

import { useState } from "react";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

export function DocumentReview({
  documentId,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
  children,
}: {
  documentId: string;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
  /** The viewer body (image, fallback card…). */
  children: React.ReactNode;
}) {
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(
    null
  );

  return (
    <ReviewPanel
      documentId={documentId}
      moments={moments}
      currentUserId={currentUserId}
      canCreate={canCreate}
      canEditAny={canEditAny}
      canDeleteAny={canDeleteAny}
      captureLabel="Flag document"
      captureAnchor={() => ({ kind: "document" })}
      composerAnchor={composerAnchor}
      onComposerAnchorChange={setComposerAnchor}
      emptyHint="Hit “Flag document” to mark this file for review."
    >
      {children}
    </ReviewPanel>
  );
}
