/**
 * SegmentEditor — inline textarea for correcting one paragraph.
 * Saves with the revision the paragraph was loaded at; a conflict (someone
 * else saved first) keeps the typed text and offers Reload.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTranscriptSegment } from "@/app/actions/transcripts";

export function SegmentEditor({
  segmentId,
  initialText,
  revision,
  onClose,
}: {
  segmentId: string;
  initialText: string;
  revision: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setConflict(false);
    startTransition(async () => {
      try {
        const res = await updateTranscriptSegment(segmentId, { text, revision });
        if (res.ok) {
          onClose();
        } else if (res.conflict) {
          setConflict(true);
        } else {
          setError(res.error);
        }
      } catch {
        setError("Couldn't save the correction. Try again.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label="Paragraph text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={Math.max(3, Math.ceil(text.length / 80))}
        maxLength={5000}
        autoFocus
        className="w-full resize-y rounded-md border border-line bg-white p-2 text-sm leading-relaxed text-ink focus:border-brand-300 focus:outline-none"
      />
      {conflict && (
        <p role="alert" className="flex items-center gap-2 text-xs text-warn">
          <span>Someone else changed this paragraph.</span>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="font-medium underline underline-offset-2"
          >
            Reload
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-7 rounded-md bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="h-7 rounded-md px-3 text-xs font-medium text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
