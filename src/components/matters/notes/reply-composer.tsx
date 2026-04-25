/**
 * Reply Composer — lightweight Tiptap inline form used to reply to a
 * specific note within the same matter. Posts to the main createNote
 * action with `parentNoteId` set so the server threads the note
 * under its parent.
 *
 * Captures (task / deadline / time) ride along the same way they do
 * on the top-level note composer — serialized into the `attachments`
 * field. The server creates them with `noteId` pointing at the new
 * reply, so they surface in that reply's attached-list immediately.
 *
 * Intentionally simpler than NoteComposer in two ways:
 *   - No type pills (replies are always plain notes)
 *   - No pin (replies inherit thread context, pinning a reply alone
 *     would orphan it from its parent)
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createNote } from "@/app/actions/notes";
import {
  noteInitialState,
  type NoteCapture,
  type NoteFormState,
} from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";
import { CaptureStack } from "@/components/matters/captures/capture-stack";

export function ReplyComposer({
  matterId,
  parentNoteId,
  onDone,
}: {
  matterId: string;
  parentNoteId: string;
  /** Called after a successful save so the parent can collapse the
   *  reply form. */
  onDone: () => void;
}) {
  const action = createNote.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    NoteFormState,
    FormData
  >(action, noteInitialState);

  const [html, setHtml] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);

  useEffect(() => {
    if (state.status === "ok") {
      setHtml("");
      setCaptures([]);
      setEditorKey((k) => k + 1);
      onDone();
    }
  }, [state.status, onDone]);

  const errs = state.errors ?? {};
  const attachmentErrors = state.attachmentErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="parentNoteId" value={parentNoteId} />
      <input type="hidden" name="type" value="note" />
      <input
        type="hidden"
        name="attachments"
        value={JSON.stringify(captures)}
      />

      <NoteEditor
        key={editorKey}
        onChange={setHtml}
        placeholder="Reply…"
        autoFocus
      />

      {errs.content && errs.content.length > 0 && (
        <div className="text-2xs text-warn">{errs.content[0]}</div>
      )}

      {/* Same capture surface as the top-level note composer, but
          scoped to the three actionable kinds — events have their own
          tab + flow, and a sibling-note off a reply isn't a meaningful
          mental model. */}
      <CaptureStack
        captures={captures}
        onChange={setCaptures}
        errors={attachmentErrors}
        allowedKinds={["task", "deadline", "time"]}
      />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || html.trim().length === 0}
          className={cn(
            "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending
            ? "Posting…"
            : captures.length > 0
              ? `Reply + ${captures.length}`
              : "Reply"}
        </button>
      </div>
    </form>
  );
}
