/**
 * Note Panel Body — rich-text note form for the Create dock.
 *
 * Same shape as the Notes-tab composer (Tiptap editor + type pills +
 * pin toggle) but rendered inside the generic Create panel chrome.
 * The panel's built-in X + Cancel handle dismissal, so this body
 * carries only the content controls and the Save button. On a
 * successful save the panel closes itself via `useCreateStack.close`.
 */

"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { createNote } from "@/app/actions/notes";
import {
  NOTE_TYPE_LABEL,
  NOTE_TYPES,
  noteInitialState,
  type NoteFormState,
} from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";
import { useCreateStack } from "@/components/create-stack/create-stack-provider";

export function NotePanelBody({
  panelId,
  matterId,
}: {
  panelId: string;
  matterId: string;
}) {
  const { close } = useCreateStack();
  const boundCreate = createNote.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    NoteFormState,
    FormData
  >(boundCreate, noteInitialState);

  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const closedRef = useRef(false);

  // On a successful save, close the panel. Guard with `closedRef` so
  // the close doesn't fire again if the component re-renders with the
  // same "ok" state.
  useEffect(() => {
    if (state.status === "ok" && !closedRef.current) {
      closedRef.current = true;
      close(panelId);
    }
  }, [state.status, close, panelId]);

  const errs = state.errors ?? {};

  return (
    <form
      action={formAction}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <input type="hidden" name="content" value={html} />
      <input type="hidden" name="type" value={type} />
      {pin && <input type="hidden" name="isPinned" value="on" />}

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
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5">
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

          <button
            type="button"
            onClick={() => {
              setHtml("");
              setEditorKey((k) => k + 1);
            }}
            className="text-2xs text-ink-3 hover:text-ink-2 ml-auto"
          >
            Clear
          </button>
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line shrink-0 bg-paper-2/30">
        <button
          type="button"
          onClick={() => close(panelId)}
          className="text-xs px-2.5 h-7 rounded-md border border-line bg-white text-ink-2 hover:border-brand-300 hover:text-brand-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || html.trim().length === 0}
          className="text-xs px-2.5 h-7 rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save note"}
        </button>
      </footer>
    </form>
  );
}
