/**
 * Edit a note — content + type (`updateNote`). Authors may always
 * edit their own note; anyone else needs `notes.edit_any` (the card
 * only offers Edit to those viewers; the action rechecks). Pinning is
 * deliberately not here: it's its own `notes.pin` control.
 *
 * The editor remounts on each open (keyed) so it always starts from
 * the note's current saved content, never a stale draft.
 */

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { updateNote } from "@/app/actions/notes";
import {
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  noteInitialState,
  type NoteFormState,
  type NoteType,
} from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";

export function EditNoteDialog({
  open,
  onOpenChange,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: { id: string; type: string; content: string };
}) {
  const [state, formAction, isPending] = useDialogActionState<NoteFormState, FormData>(
    updateNote.bind(null, note.id),
    noteInitialState,
    open,
  );
  const initialType: NoteType = (NOTE_TYPES as readonly string[]).includes(note.type)
    ? (note.type as NoteType)
    : "note";
  const [html, setHtml] = useState(note.content);
  const [type, setType] = useState<NoteType>(initialType);
  const [openCount, setOpenCount] = useState(0);

  // Reseed from the saved note on every open (render-phase reset).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setHtml(note.content);
      setType(initialType);
      setOpenCount((n) => n + 1);
    }
  }

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const contentError = state.errors?.content?.[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
          <DialogDescription>The edit is recorded on the matter&apos;s timeline.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="content" value={html} />
          <input type="hidden" name="type" value={type} />
          <NoteEditor key={openCount} initialHTML={note.content} onChange={setHtml} autoFocus />
          {contentError && <div className="text-2xs text-warn">{contentError}</div>}
          <div
            role="group"
            aria-label="Note type"
            className="flex items-center gap-0.5 self-start rounded-md border border-line bg-white p-0.5"
          >
            {NOTE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={cn(
                  "text-2xs font-medium px-2 py-0.5 rounded transition-colors",
                  type === t ? "bg-paper-2 text-ink" : "text-ink-3 hover:text-brand-700",
                )}
              >
                {NOTE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
