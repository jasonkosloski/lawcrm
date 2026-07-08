/**
 * ReviewPanel — the generic evidence-review shell shared by every
 * renderer: viewer body on the left, capture button + inline
 * FlagComposer beneath it, moments rail beside (below on small
 * screens).
 *
 * Renderer-specific wrappers (MediaReview, PdfReview, TextReview,
 * DocumentReview) act as adapters and supply the two things that
 * differ per type:
 *   (a) how to CAPTURE an anchor — `captureAnchor()` is called when
 *       the capture button is clicked (media reads currentTime, PDF
 *       opens a page input, plain documents flag anchorless); the
 *       composer is CONTROLLED (`composerAnchor` +
 *       `onComposerAnchorChange`) so adapters with out-of-band
 *       affordances (TextReview's floating "Flag selection") can
 *       open it themselves;
 *   (b) how to NAVIGATE to one — `onNavigate` (seek / #page reload /
 *       scroll-to-highlight); omit it and rows render non-clickable.
 *
 * Flags arrive server-fetched from the page — this shell never
 * fetches; after a mutation the composer/rail call router.refresh()
 * and the page re-feeds the list.
 */

"use client";

import { Flag } from "lucide-react";
import { plural } from "@/lib/utils";
import {
  FlagComposer,
  type ComposerAnchor,
} from "./flag-composer";
import { MomentsRail, type RailMoment } from "./moments-rail";

export function ReviewPanel({
  documentId,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
  captureLabel,
  captureAnchor,
  composerAnchor,
  onComposerAnchorChange,
  onNavigate,
  getCurrentTime,
  emptyHint,
  children,
}: {
  documentId: string;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
  /** Capture-button text, e.g. "Flag this moment" / "Flag a page". */
  captureLabel: string;
  /** Called at capture-button click — returns the create anchor. */
  captureAnchor: () => ComposerAnchor;
  /** Controlled composer state — non-null renders the create form. */
  composerAnchor: ComposerAnchor | null;
  onComposerAnchorChange: (anchor: ComposerAnchor | null) => void;
  /** Adapter's "go to this flag's anchor" — omit when the renderer
   *  can't navigate (image / fallback). */
  onNavigate?: (moment: RailMoment) => void;
  /** Media renderers only — feeds the composer's clock buttons. */
  getCurrentTime?: () => number | null;
  /** Renderer-specific empty-rail hint. */
  emptyHint: string;
  /** The viewer body (player / iframe / rendered sheet). */
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      {/* ── Viewer body + composer ─────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {children}

        {canCreate && composerAnchor === null && (
          <div>
            <button
              type="button"
              onClick={() => onComposerAnchorChange(captureAnchor())}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              {captureLabel}
            </button>
          </div>
        )}
        {canCreate && composerAnchor !== null && (
          <FlagComposer
            documentId={documentId}
            editing={null}
            createAnchor={composerAnchor}
            getCurrentTime={getCurrentTime}
            onClose={() => onComposerAnchorChange(null)}
          />
        )}
      </div>

      {/* ── Moments rail ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-4">
          <Flag className="h-3 w-3" aria-hidden />
          Flags
          <span className="font-mono normal-case">
            {plural(moments.length, "flag")}
          </span>
        </div>
        <MomentsRail
          documentId={documentId}
          moments={moments}
          currentUserId={currentUserId}
          canEditAny={canEditAny}
          canDeleteAny={canDeleteAny}
          onNavigate={onNavigate}
          getCurrentTime={getCurrentTime}
          emptyHint={emptyHint}
        />
      </div>
    </div>
  );
}
