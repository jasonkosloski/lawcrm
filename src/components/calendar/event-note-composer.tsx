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

import { useEffect, useState } from "react";
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

export function EventNoteComposer({
  matterId,
  eventId,
}: {
  matterId: string;
  eventId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = createNote.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // composer is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    NoteFormState,
    FormData
  >(action, noteInitialState, expanded);

  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  // Reset + collapse on success. Deps key on the state OBJECT, not
  // state.status — identity is the reliable "a submission just
  // finished" signal (see TimeComposer for the full rationale).
  useEffect(() => {
    if (state.status !== "ok") return;
    setHtml("");
    setType("note");
    setPin(false);
    setEditorKey((k) => k + 1);
    setExpanded(false);
  }, [state]);

  const errs = state.errors ?? {};

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "flex items-center gap-2 h-8 px-3 text-2xs text-ink-4 w-full",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
        )}
      >
        <Plus size={12} />
        Add a note about this event…
      </button>
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
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5">
            {NOTE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "text-2xs font-medium px-1.5 py-0.5 rounded transition-colors",
                  type === t
                    ? "bg-brand-500 text-white"
                    : "text-ink-3 hover:text-brand-700"
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
                : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300"
            )}
          >
            <Pin
              size={11}
              className={pin ? "fill-brand-500 text-brand-500" : ""}
            />
            Pin
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setHtml("");
              setEditorKey((k) => k + 1);
            }}
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
            {isPending ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </form>
  );
}
