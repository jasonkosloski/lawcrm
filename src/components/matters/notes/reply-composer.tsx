/**
 * Reply Composer — lightweight Tiptap inline form used to reply to a
 * specific note within the same matter. Posts to the main createNote
 * action with `parentNoteId` set so the server threads the note
 * under its parent.
 *
 * Intentionally simpler than the top-level NoteComposer: no type
 * pills, no pin, no sibling captures. Replies are follow-ups — if a
 * user needs full note semantics, they create a top-level note
 * instead.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createNote } from "@/app/actions/notes";
import { noteInitialState, type NoteFormState } from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";

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

  useEffect(() => {
    if (state.status === "ok") {
      setHtml("");
      setEditorKey((k) => k + 1);
      onDone();
    }
  }, [state.status, onDone]);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="parentNoteId" value={parentNoteId} />
      <input type="hidden" name="type" value="note" />
      <input type="hidden" name="attachments" value="[]" />

      <NoteEditor
        key={editorKey}
        onChange={setHtml}
        placeholder="Reply…"
        autoFocus
      />

      {errs.content && errs.content.length > 0 && (
        <div className="text-2xs text-warn">{errs.content[0]}</div>
      )}

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
          {isPending ? "Posting…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
