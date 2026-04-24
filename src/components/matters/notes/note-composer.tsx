/**
 * Note Composer — inline rich-text form at the top of the Notes tab.
 *
 * Collapsed state is a single-line placeholder that expands into the
 * full Tiptap editor + controls on click/focus. After a successful
 * save the composer collapses + resets so the next note can start
 * fresh without reload. All content is posted as an HTML string in
 * the hidden `content` field; the server action sanitizes it before
 * insert.
 */

"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { createNote } from "@/app/actions/notes";
import {
  NOTE_TYPE_LABEL,
  NOTE_TYPES,
  noteInitialState,
  type NoteCapture,
  type NoteFormState,
} from "@/lib/note-constants";
import { NoteEditor } from "./note-editor";
import { CaptureStack } from "./capture-stack";

export function NoteComposer({ matterId }: { matterId: string }) {
  const boundCreate = createNote.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    NoteFormState,
    FormData
  >(boundCreate, noteInitialState);

  const [expanded, setExpanded] = useState(false);
  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  // Bumped after each successful save so the editor remounts with a
  // fresh empty document.
  const [editorKey, setEditorKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Collapse + reset after a successful save.
  useEffect(() => {
    if (state.status !== "ok") return;
    setHtml("");
    setType("note");
    setPin(false);
    setCaptures([]);
    setExpanded(false);
    setEditorKey((k) => k + 1);
  }, [state.status]);

  const errs = state.errors ?? {};
  const attachmentErrors = state.attachmentErrors ?? {};

  return (
    <Card className={cn(expanded && "border-brand-200")}>
      <CardContent className="p-3">
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-2"
        >
          {/* Hidden fields mirror local state so the submit carries them. */}
          <input type="hidden" name="content" value={html} />
          <input type="hidden" name="type" value={type} />
          {pin && <input type="hidden" name="isPinned" value="on" />}
          <input
            type="hidden"
            name="attachments"
            value={JSON.stringify(captures)}
          />

          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={cn(
                "flex items-center gap-2 h-9 px-3 text-xs text-ink-4",
                "rounded-md border border-dashed border-line bg-white",
                "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
              )}
            >
              <Plus size={14} />
              Write a note for this matter…
            </button>
          ) : (
            <>
              <NoteEditor
                key={editorKey}
                onChange={setHtml}
                placeholder="Start typing — headings, lists, bold/italic, quotes supported."
                autoFocus
              />

              {errs.content && errs.content.length > 0 && (
                <div className="text-2xs text-warn">{errs.content[0]}</div>
              )}

              <CaptureStack
                captures={captures}
                onChange={setCaptures}
                errors={attachmentErrors}
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type pills */}
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

                  {/* Pin toggle */}
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
                    className="text-xs text-ink-3 hover:text-ink-2 px-2"
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
                      ? "Saving…"
                      : captures.length > 0
                        ? `Save note + ${captures.length}`
                        : "Save note"}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
