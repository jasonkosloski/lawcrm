/**
 * Note Panel Body — rich-text note form for the Create dock.
 *
 * Same shape as the Notes-tab composer (Tiptap editor + type pills +
 * pin toggle) but rendered inside the generic Create panel chrome.
 * The panel's built-in X + Cancel handle dismissal, so this body
 * carries only the content controls and the Save button. On a
 * successful save the panel closes itself via `useCreateStack.close`.
 *
 * Submit is dispatched by hand (see NoteComposer): a failed save keeps
 * the typed note, and success is handled in the handler.
 */

"use client";

import { useState, useTransition } from "react";
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { createNote } from "@/app/actions/notes";
import {
  NOTE_TYPE_LABEL,
  NOTE_TYPES,
  noteInitialState,
  type CaptureKind,
  type NoteCapture,
  type NoteFormState,
} from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";
import { CaptureStack } from "@/components/matters/captures/capture-stack";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";
import { Button } from "@/components/ui/button";

export function NotePanelBody({
  panelId,
  matterId,
  canPin = true,
  allowedKinds,
}: {
  panelId: string;
  matterId: string;
  /** Whether to offer the Pin toggle. The Create dock does not
   *  resolve the viewer's permissions, so this defaults to offering
   *  it; createNote still enforces `notes.pin` and answers a non-
   *  holder with a form error (the typed note is kept), not a
   *  redirect. A caller that knows the answer should pass it. */
  canPin?: boolean;
  /** Capture kinds to offer (omit for CaptureStack's default set). */
  allowedKinds?: CaptureKind[];
}) {
  const { close } = useCreateStack();
  const [state, setState] = useState<NoteFormState>(noteInitialState);
  const [isPending, startTransition] = useTransition();

  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  const [editorKey, setEditorKey] = useState(0);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createNote(matterId, noteInitialState, fd);
      if (res.status === "ok") close(panelId);
      else setState(res);
    });
  };

  const errs = state.errors ?? {};
  const attachmentErrors = state.attachmentErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="type" value={type} />
      {canPin && pin && <input type="hidden" name="isPinned" value="on" />}
      <input type="hidden" name="attachments" value={JSON.stringify(captures)} />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <NoteEditor
          key={editorKey}
          onChange={setHtml}
          placeholder="Start typing — headings, lists, bold/italic, quotes supported."
          autoFocus
        />

        {errs.content && errs.content.length > 0 && (
          <div className="text-2xs text-warn">{errs.content[0]}</div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div
            role="group"
            aria-label="Note type"
            className="flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5"
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

          {canPin && (
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
          )}

          <button
            type="button"
            onClick={() => {
              // Clear everything the user set, not just the text:
              // type, pin and queued captures must not carry into the
              // next note.
              setHtml("");
              setType("note");
              setPin(false);
              setCaptures([]);
              setState(noteInitialState);
              setEditorKey((k) => k + 1);
            }}
            className="text-2xs text-ink-3 hover:text-ink-2 ml-auto"
          >
            Clear
          </button>
        </div>

        <CaptureStack
          captures={captures}
          onChange={setCaptures}
          errors={attachmentErrors}
          allowedKinds={allowedKinds}
        />
      </div>

      <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0 bg-paper-2/30">
        <Button variant="outline" size="xs" type="button" onClick={() => close(panelId)}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={isPending || html.trim().length === 0}>
          {isPending
            ? "Saving…"
            : captures.length > 0
              ? `Save note + ${captures.length}`
              : "Save note"}
        </Button>
      </footer>
    </form>
  );
}
