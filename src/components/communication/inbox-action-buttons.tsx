/**
 * Inbox Action Buttons
 *
 * Three buttons (Save as note · Create task · Create deadline)
 * surfaced on email-thread headers and messenger items. Each opens
 * a small dialog with the source content prefilled, posts to the
 * matching server action, then closes.
 *
 * `source` discriminates which action set to bind. The component
 * is the same for both — the dialog action is bound to the source
 * id and the right action.
 *
 * If the source isn't filed to a matter, all three buttons render
 * disabled with a tooltip telling the user to file the source first.
 *
 * Each button is also hidden when the viewer lacks the matching
 * create permission (the server actions would otherwise redirect the
 * whole page to the dashboard mid-dialog) - the parent reader
 * resolves the flags server-side and passes them down.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert, ListTodo, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  createDeadlineFromEmail,
  createDeadlineFromMessage,
  createNoteFromEmail,
  createNoteFromMessage,
  createTaskFromEmail,
  createTaskFromMessage,
} from "@/app/actions/inbox-actions";
import {
  inboxActionInitialState,
  type InboxActionFormState,
} from "@/lib/inbox-action-form";
import { NOTE_TYPES, NOTE_TYPE_LABEL } from "@/lib/note-constants";
import {
  DEADLINE_KINDS,
  DEADLINE_KIND_LABEL,
} from "@/lib/constants/deadline-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { paragraphsToHtml } from "@/lib/text-to-html";
import { escapeHtml } from "@/lib/email/escape";
import { inputClass, textareaClass } from "@/components/ui/field";

export type InboxSource =
  | { kind: "email"; id: string; subject: string; snippet: string }
  | {
      kind: "messenger";
      id: string;
      contactLabel: string; // contact name or pretty phone
      preview: string; // body or transcript or "Missed call"
    };

type Affordance = "task" | "deadline" | "note" | null;

export function InboxActionButtons({
  source,
  isFiled,
  canCreateNote = true,
  canCreateTask = true,
  canCreateDeadline = true,
}: {
  source: InboxSource;
  isFiled: boolean;
  /** `notes.create` - hides "Save as note" when false. */
  canCreateNote?: boolean;
  /** `tasks.create` - hides "Create task" when false. */
  canCreateTask?: boolean;
  /** `deadlines.create` - hides "Create deadline" when false. */
  canCreateDeadline?: boolean;
}) {
  const [open, setOpen] = useState<Affordance>(null);

  if (!canCreateNote && !canCreateTask && !canCreateDeadline) return null;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {canCreateNote && (
          <Btn
            icon={<StickyNote size={11} />}
            label="Save as note"
            disabled={!isFiled}
            tooltip={
              isFiled
                ? "Save this as a note on the matter"
                : sourceUnfiledMsg(source)
            }
            onClick={() => setOpen("note")}
          />
        )}
        {canCreateTask && (
          <Btn
            icon={<ListTodo size={11} />}
            label="Create task"
            disabled={!isFiled}
            tooltip={
              isFiled
                ? "Create a task with this as context"
                : sourceUnfiledMsg(source)
            }
            onClick={() => setOpen("task")}
          />
        )}
        {canCreateDeadline && (
          <Btn
            icon={<CircleAlert size={11} />}
            label="Create deadline"
            disabled={!isFiled}
            tooltip={
              isFiled
                ? "Create a deadline tied to this"
                : sourceUnfiledMsg(source)
            }
            onClick={() => setOpen("deadline")}
          />
        )}
      </div>

      {open === "task" && (
        <CreateTaskDialog source={source} onClose={() => setOpen(null)} />
      )}
      {open === "deadline" && (
        <CreateDeadlineDialog source={source} onClose={() => setOpen(null)} />
      )}
      {open === "note" && (
        <CreateNoteDialog source={source} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function sourceUnfiledMsg(source: InboxSource): string {
  return source.kind === "email"
    ? "File this email thread to a matter first"
    : "File this conversation to a matter first";
}

function Btn({
  icon,
  label,
  disabled,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={label}
      className="text-2xs hover:bg-brand-soft disabled:hover:border-line disabled:hover:text-ink-3 disabled:hover:bg-white"
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Build the default title for a task/deadline created from a source.
 *  Exported for tests only - not part of the component's API. */
export function defaultTitleFromSource(source: InboxSource): string {
  if (source.kind === "email") {
    // Strip every leading reply/forward prefix (Re:, Fwd:, Fw:,
    // "Re :", repeated or mixed) so the task title isn't
    // "Re: Re: Fwd: Discovery cutoff…". A subject that is ONLY a
    // prefix keeps its original text rather than going blank.
    const stripped = source.subject
      .replace(/^(?:\s*(?:re|fwd?|fw)\s*:\s*)+/i, "")
      .trim();
    return stripped || source.subject.trim();
  }
  return `Re: ${source.contactLabel}`;
}

/** Build the default note prefill — quotes the source so the note has
 *  context on its own. Stored as HTML; the note action sanitizes. */
function defaultNoteHtml(source: InboxSource): string {
  if (source.kind === "email") {
    const escaped = escapeHtml(source.snippet);
    return `<p><em>From email: ${escapeHtml(source.subject)}</em></p><blockquote>${escaped}</blockquote><p></p>`;
  }
  const escaped = escapeHtml(source.preview);
  return `<p><em>From message: ${escapeHtml(source.contactLabel)}</em></p><blockquote>${escaped}</blockquote><p></p>`;
}

// ── Dialogs ────────────────────────────────────────────────────────────

function CreateTaskDialog({
  source,
  onClose,
}: {
  source: InboxSource;
  onClose: () => void;
}) {
  const action =
    source.kind === "email"
      ? createTaskFromEmail.bind(null, source.id)
      : createTaskFromMessage.bind(null, source.id);
  const [state, formAction, isPending] = useActionState<
    InboxActionFormState,
    FormData
  >(action, inboxActionInitialState);

  const [title, setTitle] = useState(defaultTitleFromSource(source));
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.status === "ok") onClose();
  }, [state.status, onClose]);

  const errs = state.errors ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>
            {source.kind === "email"
              ? `From email: ${source.subject}`
              : `From message: ${source.contactLabel}`}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              autoFocus
              className={inputClass(!!errs.title)}
            />
            {errs.title && (
              <div className="text-2xs text-warn">{errs.title[0]}</div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-0.5">
              <input
                type="date"
                name="dueDate"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Due date"
                className={inputClass(!!errs.dueDate)}
              />
              {errs.dueDate && (
                <div className="text-2xs text-warn">{errs.dueDate[0]}</div>
              )}
            </div>
            <NativeSelect
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full"
            >
              {TASK_PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details (optional)"
            rows={3}
            className={cn(textareaClass(), "leading-relaxed resize-y font-sans")}
          />
          {errs.description && (
            <div className="text-2xs text-warn">{errs.description[0]}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateDeadlineDialog({
  source,
  onClose,
}: {
  source: InboxSource;
  onClose: () => void;
}) {
  const action =
    source.kind === "email"
      ? createDeadlineFromEmail.bind(null, source.id)
      : createDeadlineFromMessage.bind(null, source.id);
  const [state, formAction, isPending] = useActionState<
    InboxActionFormState,
    FormData
  >(action, inboxActionInitialState);

  const [title, setTitle] = useState(defaultTitleFromSource(source));
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<(typeof DEADLINE_KINDS)[number]>("manual");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.status === "ok") onClose();
  }, [state.status, onClose]);

  const errs = state.errors ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create deadline</DialogTitle>
          <DialogDescription>
            {source.kind === "email"
              ? `From email: ${source.subject}`
              : `From message: ${source.contactLabel}`}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Deadline title"
              autoFocus
              className={inputClass(!!errs.title)}
            />
            {errs.title && (
              <div className="text-2xs text-warn">{errs.title[0]}</div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-0.5">
              <input
                type="date"
                name="dueDate"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Due date"
                required
                className={inputClass(!!errs.dueDate)}
              />
              {errs.dueDate && (
                <div className="text-2xs text-warn">{errs.dueDate[0]}</div>
              )}
            </div>
            <NativeSelect
              name="kind"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as (typeof DEADLINE_KINDS)[number])
              }
              className="w-full"
            >
              {DEADLINE_KINDS.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {DEADLINE_KIND_LABEL[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why this deadline applies (optional)"
            rows={3}
            className={cn(textareaClass(), "leading-relaxed resize-y font-sans")}
          />
          {errs.description && (
            <div className="text-2xs text-warn">{errs.description[0]}</div>
          )}
          {errs.kind && (
            <div className="text-2xs text-warn">{errs.kind[0]}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create deadline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateNoteDialog({
  source,
  onClose,
}: {
  source: InboxSource;
  onClose: () => void;
}) {
  const action =
    source.kind === "email"
      ? createNoteFromEmail.bind(null, source.id)
      : createNoteFromMessage.bind(null, source.id);
  const [state, formAction, isPending] = useActionState<
    InboxActionFormState,
    FormData
  >(action, inboxActionInitialState);

  // Plain textarea for v1 — the dialog is for quick capture, not full
  // formatting. The note itself supports rich text once viewed in the
  // notes tab; users can edit there for headings / bold / etc.
  const [content, setContent] = useState(stripHtmlForTextarea(defaultNoteHtml(source)));
  const [type, setType] = useState("note");

  useEffect(() => {
    if (state.status === "ok") onClose();
  }, [state.status, onClose]);

  const errs = state.errors ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as note</DialogTitle>
          <DialogDescription>
            {source.kind === "email"
              ? `From email: ${source.subject}`
              : `From message: ${source.contactLabel}`}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          {/* Wrap the textarea in HTML before posting so the server's
              HTML sanitizer + storage path stays consistent. */}
          <input
            type="hidden"
            name="content"
            value={paragraphsToHtml(content)}
          />

          <NativeSelect
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="self-start"
          >
            {NOTE_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {NOTE_TYPE_LABEL[t]}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            autoFocus
            className={cn(textareaClass(), "leading-relaxed resize-y font-sans")}
          />
          {errs.content && (
            <div className="text-2xs text-warn">{errs.content[0]}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
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

/** Roundtrip: HTML default → plain text textarea → HTML on submit.
 *  Newlines become paragraphs; the leading "From email/message:"
 *  italic survives the roundtrip via plain-text "From …" + blank
 *  line + the quoted body.
 *
 *  Exported for tests only — not part of the component's API. */
export function stripHtmlForTextarea(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/g, "\n\n")
    // "From email: ..." header, then a blank line, then the quote.
    .replace(/<\/p>\s*<blockquote>/g, "\n\n> ")
    .replace(/<blockquote>/g, "> ")
    .replace(/<\/blockquote>/g, "")
    .replace(/<em>(.*?)<\/em>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Decode &amp; LAST: a snippet containing literal "&lt;" arrives
    // here as "&amp;lt;"; decoding &amp; first would turn that into
    // "&lt;" and then a second pass into "<", corrupting the text.
    .replace(/&amp;/g, "&")
    .trim();
}

