/**
 * Note Composer — inline rich-text form at the top of the Notes tab.
 *
 * Collapsed state is a single-line placeholder that expands into the
 * full Tiptap editor + controls on click/focus. After a successful
 * save the composer collapses + resets so the next note can start
 * fresh without reload. All content is posted as an HTML string in
 * the hidden `content` field; the server action sanitizes it before
 * insert.
 *
 * The submit is dispatched by hand (not `<form action>`): React 19
 * resets a form-action form after the action settles even when it
 * returned a validation error, which would wipe what the user typed.
 * The result is read in the handler, so a save resets the composer
 * right there and a failure leaves everything in place.
 *
 * `scope` picks the write: a matter note (createNote, captures
 * allowed) or an intake note on a lead (createLeadNote — the page
 * passes no capture kinds, since tasks/deadlines/events need a
 * matter).
 */

"use client";

import { useState, useTransition } from "react";
import { Pin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { createLeadNote, createNote } from "@/app/actions/notes";
import {
  NOTE_TYPE_LABEL,
  NOTE_TYPES,
  noteInitialState,
  type CaptureKind,
  type NoteCapture,
  type NoteFormState,
} from "@/lib/note-constants";
import type { NoteScope } from "@/lib/note-scope";
import { NoteEditor } from "./note-editor";
import { CaptureStack } from "@/components/matters/captures/capture-stack";

export function NoteComposer({
  scope,
  canPin = false,
  allowedKinds,
}: {
  scope: NoteScope;
  /** Whether the viewer holds `notes.pin`. The Pin toggle is hidden
   *  without it — createNote rejects a pinned note from anyone who
   *  lacks the key. Defaults to false (hidden) so a caller that
   *  forgets to resolve it fails closed. */
  canPin?: boolean;
  /** Capture kinds the viewer may create (each needs its own create
   *  permission). Omit to offer CaptureStack's default set. */
  allowedKinds?: CaptureKind[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<NoteFormState>(noteInitialState);
  const [isPending, startTransition] = useTransition();

  const [html, setHtml] = useState("");
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>("note");
  const [pin, setPin] = useState(false);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  // Bumped on every reset so the editor remounts with a fresh empty
  // document.
  const [editorKey, setEditorKey] = useState(0);

  // Back to a pristine, collapsed composer. Used by both Cancel and a
  // successful save: type, pin and queued captures must not leak into
  // the next note.
  const reset = () => {
    setHtml("");
    setType("note");
    setPin(false);
    setCaptures([]);
    setExpanded(false);
    setState(noteInitialState);
    setEditorKey((k) => k + 1);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res =
        scope.kind === "matter"
          ? await createNote(scope.matterId, noteInitialState, fd)
          : await createLeadNote(scope.leadId, noteInitialState, fd);
      if (res.status === "ok") reset();
      else setState(res);
    });
  };

  const errs = state.errors ?? {};
  const attachmentErrors = state.attachmentErrors ?? {};

  return (
    <Card className={cn(expanded && "border-brand-200")}>
      <CardContent className="p-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          {/* Hidden fields mirror local state so the submit carries them. */}
          <input type="hidden" name="content" value={html} />
          <input type="hidden" name="type" value={type} />
          {canPin && pin && <input type="hidden" name="isPinned" value="on" />}
          <input
            type="hidden"
            name="attachments"
            value={JSON.stringify(captures)}
          />

          {!expanded ? (
            <button
              type="button"
              onClick={() => {
                // A failed attempt's errors belong to that attempt.
                setState(noteInitialState);
                setExpanded(true);
              }}
              className={cn(
                "flex items-center gap-2 h-9 px-3 text-xs text-ink-4",
                "rounded-md border border-dashed border-line bg-white",
                "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
              )}
            >
              <Plus size={14} />
              {scope.kind === "matter"
                ? "Write a note for this matter…"
                : "Write an intake note…"}
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
                allowedKinds={allowedKinds}
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type pills */}
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
                          type === t
                            ? "bg-brand-500 text-white"
                            : "text-ink-3 hover:text-brand-700"
                        )}
                      >
                        {NOTE_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>

                  {/* Pin toggle — notes.pin holders only */}
                  {canPin && (
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
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={reset}
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
