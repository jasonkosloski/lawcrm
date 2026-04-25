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
import {
  DEADLINE_KINDS,
  TASK_PRIORITIES,
  todayDateString,
} from "@/lib/note-constants";

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
  /** Compact mode renders icon-only buttons (for the cramped voicemail
   *  card footer). Default is the labelled chip style for the email
   *  thread header. */
  compact = false,
}: {
  source: InboxSource;
  isFiled: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Affordance>(null);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5",
          compact && "flex-wrap"
        )}
      >
        <Btn
          icon={<StickyNote size={11} />}
          label="Save as note"
          compact={compact}
          disabled={!isFiled}
          tooltip={
            isFiled
              ? "Save this as a note on the matter"
              : sourceUnfiledMsg(source)
          }
          onClick={() => setOpen("note")}
        />
        <Btn
          icon={<ListTodo size={11} />}
          label="Create task"
          compact={compact}
          disabled={!isFiled}
          tooltip={
            isFiled
              ? "Create a task with this as context"
              : sourceUnfiledMsg(source)
          }
          onClick={() => setOpen("task")}
        />
        <Btn
          icon={<CircleAlert size={11} />}
          label="Create deadline"
          compact={compact}
          disabled={!isFiled}
          tooltip={
            isFiled
              ? "Create a deadline tied to this"
              : sourceUnfiledMsg(source)
          }
          onClick={() => setOpen("deadline")}
        />
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
  compact,
  disabled,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  compact: boolean;
  disabled: boolean;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 h-7 px-2 text-2xs font-medium rounded-md border transition-colors",
        "bg-white text-ink-3 border-line",
        "hover:border-brand-300 hover:text-brand-700 hover:bg-brand-soft",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-3 disabled:hover:bg-white"
      )}
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Build the default title for a task/deadline created from a source. */
function defaultTitleFromSource(source: InboxSource): string {
  if (source.kind === "email") {
    // Strip common reply/forward prefixes so the task title isn't
    // "Re: Re: Fwd: Discovery cutoff…"
    return source.subject.replace(/^(re:|fwd:|re :|fwd :)\s*/gi, "").trim();
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
              className={cn(
                "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.title ? "border-warn" : "border-line"
              )}
            />
            {errs.title && (
              <div className="text-2xs text-warn">{errs.title[0]}</div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="date"
              name="dueDate"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
              className={cn(
                "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.dueDate ? "border-warn" : "border-line"
              )}
            />
            <select
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink capitalize focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details (optional)"
            rows={3}
            className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink leading-relaxed focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-y font-sans"
          />

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
              className={cn(
                "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.title ? "border-warn" : "border-line"
              )}
            />
            {errs.title && (
              <div className="text-2xs text-warn">{errs.title[0]}</div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="date"
              name="dueDate"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
              className={cn(
                "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.dueDate ? "border-warn" : "border-line"
              )}
            />
            <select
              name="kind"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as (typeof DEADLINE_KINDS)[number])
              }
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink capitalize focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              {DEADLINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why this deadline applies (optional)"
            rows={3}
            className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink leading-relaxed focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-y font-sans"
          />

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
            value={textareaToHtml(content)}
          />

          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink capitalize focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 self-start"
          >
            <option value="note">Note</option>
            <option value="strategy">Strategy</option>
            <option value="memo">Memo</option>
            <option value="chatter">Chatter</option>
          </select>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            autoFocus
            className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink leading-relaxed focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-y font-sans"
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
 *  line + the quoted body. */
function stripHtmlForTextarea(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<blockquote>/g, "> ")
    .replace(/<\/blockquote>/g, "")
    .replace(/<em>(.*?)<\/em>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function textareaToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      // Escape FIRST so the <br> we insert next isn't itself escaped.
      const escaped = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
