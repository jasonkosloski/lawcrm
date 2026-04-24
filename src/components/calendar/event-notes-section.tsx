/**
 * Event Notes Section — compact list of notes attached to a specific
 * calendar event, plus the inline composer for creating a new one.
 *
 * Renders inside the event detail modal. Cards are flatter than the
 * full NoteCard (no threading, no link chip — we're already inside
 * the event the note is attached to). Full threading + filtering
 * lives on the matter's Notes tab.
 */

"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteNote, toggleNotePin } from "@/app/actions/notes";
import { NOTE_TYPE_LABEL, type NoteType } from "@/lib/note-constants";
import type { EventNote } from "@/lib/queries/calendar";
import { EventNoteComposer } from "./event-note-composer";

const formatDateTime = (d: Date): string =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function EventNotesSection({
  eventId,
  matterId,
  matterName,
  notes,
}: {
  eventId: string;
  /** Null for firm-wide events — notes require a matter, so the
   *  composer hides when this is null. Existing notes (if any) still
   *  render read-only. */
  matterId: string | null;
  matterName: string | null;
  notes: EventNote[];
}) {
  return (
    <div className="pt-3 border-t border-line flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Notes {notes.length > 0 && `(${notes.length})`}
        </div>
        {matterId && notes.length > 0 && (
          <Link
            href={`/matters/${matterId}/notes`}
            className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline"
          >
            All matter notes
            <ExternalLink size={10} />
          </Link>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <EventNoteItem key={n.id} note={n} />
          ))}
        </ul>
      )}

      {matterId ? (
        <EventNoteComposer matterId={matterId} eventId={eventId} />
      ) : (
        <p className="text-2xs text-ink-4">
          Firm-wide events can&apos;t have notes — link this event to a
          matter first.
        </p>
      )}

      {matterName && matterId && (
        <p className="text-2xs text-ink-4">
          Notes attach to{" "}
          <span className="text-ink-3 font-medium">{matterName}</span> and
          surface on the matter&apos;s Notes tab with the event link chip.
        </p>
      )}
    </div>
  );
}

function EventNoteItem({ note }: { note: EventNote }) {
  const [pending, startTransition] = useTransition();

  const onTogglePin = () => {
    startTransition(async () => {
      const res = await toggleNotePin(note.id);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  const onDelete = () => {
    if (!confirm("Delete this note? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteNote(note.id);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  const typeLabel = NOTE_TYPE_LABEL[note.type as NoteType] ?? note.type;

  return (
    <li
      className={cn(
        "rounded-md border border-line bg-paper-2/40 p-3 flex flex-col gap-2",
        note.isPinned && "border-brand-200 bg-brand-soft/30",
        pending && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
          title={note.authorName}
        >
          {note.authorInitials}
        </span>
        <div className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="text-2xs font-medium text-ink-2 truncate">
            {note.authorName}
          </span>
          <span className="text-[10px] text-ink-4 font-mono">
            {formatDateTime(note.createdAt)}
          </span>
        </div>
        <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-white text-ink-3 border-line shrink-0">
          {typeLabel}
        </span>
        <button
          type="button"
          onClick={onTogglePin}
          disabled={pending}
          title={note.isPinned ? "Unpin" : "Pin to top"}
          aria-label={note.isPinned ? "Unpin note" : "Pin note"}
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors",
            note.isPinned
              ? "text-brand-700 hover:bg-brand-soft"
              : "text-ink-3 hover:text-brand-700 hover:bg-brand-soft"
          )}
        >
          <Pin
            size={11}
            className={cn(note.isPinned && "fill-brand-500 text-brand-500")}
          />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          title="Delete"
          aria-label="Delete note"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-3 hover:text-warn hover:bg-warn-soft transition-colors disabled:opacity-60"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div
        className={cn(
          "prose prose-sm max-w-none text-xs text-ink leading-relaxed",
          "[&_p]:my-1 [&_p]:text-xs [&_p]:text-ink",
          "[&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-0.5",
          "[&_h3]:text-2xs [&_h3]:font-semibold [&_h3]:mt-1 [&_h3]:mb-0.5",
          "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-xs [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
          "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono",
          "[&_pre]:bg-paper-2 [&_pre]:p-1.5 [&_pre]:rounded [&_pre]:text-[11px]"
        )}
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
    </li>
  );
}
