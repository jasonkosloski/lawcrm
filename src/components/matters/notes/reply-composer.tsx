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
 * Only the kinds the viewer may create are offered.
 *
 * Intentionally simpler than NoteComposer in two ways:
 *   - No type pills (replies are always plain notes)
 *   - No pin (replies inherit thread context, pinning a reply alone
 *     would orphan it from its parent)
 *
 * On an intake (lead) note the reply posts through createLeadNote
 * and offers no captures — those need a matter.
 *
 * Submit is dispatched by hand (see NoteComposer): a failed save keeps
 * the typed reply, and success is handled in the handler.
 */

"use client";

import { useState, useTransition } from "react";
import { createLeadNote, createNote } from "@/app/actions/notes";
import {
  allowedCaptureKinds,
  noteInitialState,
  type NoteAccess,
  type NoteCapture,
  type NoteFormState,
} from "@/lib/note-constants";
import type { NoteScope } from "@/lib/note-scope";
import { NoteEditor } from "./note-editor";
import { CaptureStack } from "@/components/matters/captures/capture-stack";
import { Button } from "@/components/ui/button";

export function ReplyComposer({
  scope,
  parentNoteId,
  access,
  onDone,
}: {
  scope: NoteScope;
  parentNoteId: string;
  /** Viewer's permissions - narrows the capture kinds offered. */
  access: NoteAccess;
  /** Called after a successful save so the parent can collapse the
   *  reply form. */
  onDone: () => void;
}) {
  const [state, setState] = useState<NoteFormState>(noteInitialState);
  const [isPending, startTransition] = useTransition();

  const [html, setHtml] = useState("");
  const [captures, setCaptures] = useState<NoteCapture[]>([]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res =
        scope.kind === "matter"
          ? await createNote(scope.matterId, noteInitialState, fd)
          : await createLeadNote(scope.leadId, noteInitialState, fd);
      // The parent collapses (unmounts) this form on success, so
      // there is no local state left to reset.
      if (res.status === "ok") onDone();
      else setState(res);
    });
  };

  const errs = state.errors ?? {};
  const attachmentErrors = state.attachmentErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="parentNoteId" value={parentNoteId} />
      <input type="hidden" name="type" value="note" />
      <input type="hidden" name="attachments" value={JSON.stringify(captures)} />

      <NoteEditor onChange={setHtml} placeholder="Reply…" autoFocus />

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
        allowedKinds={
          scope.kind === "matter" ? allowedCaptureKinds(access, ["task", "deadline", "time"]) : []
        }
      />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <Button size="xs" type="submit" disabled={isPending || html.trim().length === 0}>
          {isPending ? "Posting…" : captures.length > 0 ? `Reply + ${captures.length}` : "Reply"}
        </Button>
      </div>
    </form>
  );
}
