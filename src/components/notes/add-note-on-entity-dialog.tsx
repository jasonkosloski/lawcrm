/**
 * Add Note on Task / Deadline dialog.
 *
 * Sibling of `LogTimeOnEntityDialog` — same modal shape, but the body
 * captures a note (type + free text) instead of a time entry. The
 * `action` prop is pre-bound to a parent (taskId / deadlineId) so the
 * dialog itself doesn't know which kind it's writing against.
 *
 * Plain-text body deliberately — the inline composers on these
 * surfaces don't need the full Tiptap editor that lives on the matter
 * Notes tab. The server action escapes + converts newlines to <br>
 * so the persisted HTML matches every other note renderer.
 */

"use client";

import { useEffect, useState } from "react";
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
import { TextareaField } from "@/components/matters/captures/primary-fields";
import { cn } from "@/lib/utils";
import {
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  type NoteType,
} from "@/lib/note-constants";
import {
  noteAttachmentInitialState,
  type NoteAttachmentFormState,
} from "@/lib/note-attachment-form";

export function AddNoteOnEntityDialog({
  open,
  onOpenChange,
  action,
  parentLabel,
  parentKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-bound server action — `addNoteToTask.bind(null, id)` or
   *  `addNoteToDeadline.bind(null, id)` from the call site. */
  action: (
    prev: NoteAttachmentFormState,
    formData: FormData
  ) => Promise<NoteAttachmentFormState>;
  /** What the note is being added to, shown in the dialog
   *  description so context is obvious. */
  parentLabel: string;
  parentKind: "task" | "deadline";
}) {
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's errors don't reappear when the
  // dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    NoteAttachmentFormState,
    FormData
  >(action, noteAttachmentInitialState, open);

  const [content, setContent] = useState("");
  const [type, setType] = useState<NoteType>("note");

  useEffect(() => {
    if (!open) return;
    setContent("");
    setType("note");
  }, [open]);

  // Close on success. Deps key on the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever and a second success would skip the effect,
  // leaving the dialog open. Each action invocation returns a
  // fresh object, so identity is the reliable "a submission just
  // finished" signal.
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add note on {parentKind}</DialogTitle>
          <DialogDescription className="truncate">
            {parentLabel}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          {/* Hidden type input mirrors the segmented control below — the
              control writes to React state, the hidden input writes to
              the form so we don't need a controlled <select>. */}
          <input type="hidden" name="type" value={type} />
          <div className="inline-flex items-center gap-0.5 rounded-md border border-line bg-paper-2 p-0.5 self-start">
            {NOTE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "text-2xs font-medium px-2 py-0.5 rounded transition-colors",
                  type === t
                    ? "bg-brand-500 text-white"
                    : "text-ink-3 hover:text-brand-700"
                )}
              >
                {NOTE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <TextareaField
            name="content"
            value={content}
            onChange={setContent}
            placeholder="Write a note…"
            rows={5}
            error={errs.content?.[0]}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !content.trim()}>
              {isPending ? "Saving…" : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
