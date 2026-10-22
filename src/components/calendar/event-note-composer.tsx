/**
 * Event Note Composer — Tiptap form embedded in the event detail modal.
 *
 * Collapsed "Add a note about this event…" button expands into a
 * Tiptap editor with type pills and a pin toggle. Submit posts to
 * `createNote` with `calendarEventId` set so the server links the
 * note directly to the event — same path matter-tab composers use
 * when capturing a sibling note.
 *
 * Intentionally lightweight: no "Also capture" siblings (the full
 * flow still lives on the matter's Notes tab). If you need task /
 * deadline / time entries alongside, open Notes and use the main
 * composer.
 */

"use client";

import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Pin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createNote } from "@/app/actions/notes";
import { NoteEditor } from "@/components/matters/notes/note-editor";
import {
  NOTE_TYPE_LABEL,
  NOTE_TYPES,
  noteInitialState,
  type NoteFormState,
} from "@/lib/note-constants";
import { Button } from "@/components/ui/button";

export function EventNoteComposer({ matterId, eventId }: { matterId: string; eventId: string }) {
  const [expanded, setExpanded] = useState(false);

  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  // One reset for every way the draft ends — a saved note AND Cancel —
  // so a discarded "Strategy + Pin" draft can't leak into the next
  // quick note.
  const reset = () => {
    setHtml("");
    setType("note");
    setPin(false);
    setEditorKey((k) => k + 1);
  };

  // Reset + collapse when the save lands, from inside the action
  // itself (an event-driven path) instead of an effect watching the
  // returned state.
  const action = async (prev: NoteFormState, formData: FormData) => {
    const result = await createNote(matterId, prev, formData);
    if (result.status === "ok") {
      reset();
      setExpanded(false);
    }
    return result;
  };
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // composer is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<NoteFormState, FormData>(
    action,
    noteInitialState,
    expanded,
  );

  const errs = state.errors ?? {};

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setExpanded(true)}
        className="flex gap-2 text-2xs text-ink-4 w-full border-dashed text-left"
      >
        <Plus size={12} />
        Add a note about this event…
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="calendarEventId" value={eventId} />
      <input type="hidden" name="attachments" value="[]" />
      {pin && <input type="hidden" name="isPinned" value="on" />}

      <NoteEditor
        key={editorKey}
        onChange={setHtml}
        placeholder="Court note, outcome, follow-ups…"
        autoFocus
      />

      {errs.content && errs.content.length > 0 && (
        <div className="text-2xs text-warn">{errs.content[0]}</div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 rounded-md bg-paper-2 p-0.5">
            {NOTE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "text-2xs font-medium px-1.5 py-0.5 rounded transition-colors",
                  type === t ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                )}
              >
                {NOTE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPin((p) => !p)}
            aria-pressed={pin}
            className={cn(
              "inline-flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-medium border transition-colors",
              pin
                ? "bg-brand-soft text-brand-700 border-brand-200"
                : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300",
            )}
          >
            <Pin size={11} className={pin ? "fill-brand-500 text-brand-500" : ""} />
            Pin
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              reset();
            }}
            className="text-2xs text-ink-3 hover:text-ink-2 px-2"
          >
            Cancel
          </button>
          <Button size="xs" type="submit" disabled={isPending || html.trim().length === 0}>
            {isPending ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    </form>
  );
}
