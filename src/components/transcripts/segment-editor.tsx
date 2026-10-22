/**
 * SegmentEditor — inline textarea for correcting one paragraph.
 * Saves with the revision the paragraph was loaded at. On a conflict (someone
 * else saved first) it refreshes, keeps the typed text and shows their
 * current paragraph; the user must choose "Use theirs" or "Keep mine and
 * save" (the explicit overwrite) - a save never silently adopts the newer
 * revision.
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
  // The revision the next save is made against; moves only by a user choice.
  const [baseRevision, setBaseRevision] = useState(revision);
  const [theirs, setTheirs] = useState<{ text: string; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateTranscriptSegment(segmentId, {
          text,
          revision: baseRevision,
        });
        if (res.ok) {
          onClose();
        } else if (res.conflict) {
          router.refresh();
          if (res.current) setTheirs(res.current);
          else setError(res.error);
        } else {
          setError(res.error);
        }
      } catch {
        setError("Couldn't save the correction. Try again.");
      }
    });
  };

  const useTheirs = () => {
    if (!theirs) return;
    setText(theirs.text);
    setBaseRevision(theirs.revision);
    setTheirs(null);
  };

  const keepMine = () => {
    if (!theirs) return;
    // Explicit overwrite: save my text over their newer revision.
    setBaseRevision(theirs.revision);
    setTheirs(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateTranscriptSegment(segmentId, {
          text,
          revision: theirs.revision,
        });
        if (res.ok) {
          onClose();
        } else if (res.conflict) {
          router.refresh();
          if (res.current) {
            setBaseRevision(res.current.revision);
            setTheirs(res.current);
          } else setError(res.error);
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
      {theirs && (
        <div role="alert" className="rounded-md border border-warn-border bg-warn-soft p-2 text-xs text-warn">
          <p className="font-medium">Someone else changed this paragraph.</p>
          <p className="mt-1 text-2xs font-semibold uppercase tracking-wide">Their version</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">{theirs.text}</p>
        </div>
      )}
      <textarea
        aria-label="Paragraph text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !theirs) save();
        }}
        rows={Math.max(3, Math.ceil(text.length / 80))}
        maxLength={5000}
        autoFocus
        className="w-full resize-y rounded-md border border-line bg-white p-2 text-sm leading-relaxed text-ink focus:border-brand-300 focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {theirs ? (
          <>
            <button
              type="button"
              onClick={useTheirs}
              disabled={pending}
              className="h-7 rounded-md border border-line bg-white px-3 text-xs font-medium text-ink-2 hover:text-ink disabled:opacity-50"
            >
              Use theirs
            </button>
            <button
              type="button"
              onClick={keepMine}
              disabled={pending}
              className="h-7 rounded-md bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Keep mine and save
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-7 rounded-md bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Save
          </button>
        )}
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
