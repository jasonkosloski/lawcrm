/**
 * Row Attached Notes
 *
 * A click-to-expand panel for showing notes attached to a task,
 * deadline, or time entry. Renders nothing when no notes — keeps
 * dense list views (Tasks tab, Deadlines tab, Time tab) uncluttered.
 *
 * Design parity with the events tab: when expanded, each note shows
 * as a flat compact card (avatar, author, type chip, timestamp,
 * sanitized HTML body). Composer is intentionally NOT included here
 * — creating notes from these tabs is a side-trip that goes to the
 * Notes tab, where the full composer + threading lives.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_TYPE_LABEL, type NoteType } from "@/lib/note-constants";
import type { AttachedNotePreview } from "@/lib/queries/matter-detail";

const formatDateTime = (d: Date): string =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function RowAttachedNotes({
  notes,
  matterId,
  /** When true, the chip + panel render with smaller padding so
   *  they fit inside a tight table cell (Deadlines + Time tabs). */
  compact = false,
}: {
  notes: AttachedNotePreview[];
  matterId: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (notes.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "" : "mt-1")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "self-start inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-md border border-line bg-paper-2/60 text-ink-3",
          "hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700 transition-colors"
        )}
      >
        {expanded ? (
          <ChevronDown size={10} className="shrink-0" />
        ) : (
          <ChevronRight size={10} className="shrink-0" />
        )}
        <MessageSquare size={10} className="shrink-0 text-ink-4" />
        <span>
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </span>
      </button>

      {expanded && (
        <ul className="flex flex-col gap-1.5 pl-1">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} matterId={matterId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteItem({
  note,
  matterId,
}: {
  note: AttachedNotePreview;
  matterId: string;
}) {
  const typeLabel = NOTE_TYPE_LABEL[note.type as NoteType] ?? note.type;
  return (
    <li className="rounded-md border border-line bg-paper-2/40 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-[10px] font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
          title={note.authorName}
        >
          {note.authorInitials}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-2xs font-medium text-ink-2 truncate">
            {note.authorName}
          </span>
          <span className="text-[10px] font-mono text-ink-4">
            {formatDateTime(note.createdAt)}
          </span>
        </div>
        <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-white text-ink-3 border-line shrink-0">
          {typeLabel}
        </span>
        {/* Anchor link to the full note in the Notes tab — same
            pattern the EntitySourceChip uses for symmetric navigation. */}
        <Link
          href={`/matters/${matterId}/notes#note-${note.id}`}
          className="text-[10px] text-brand-700 hover:underline shrink-0"
        >
          Open
        </Link>
      </div>

      <div
        className={cn(
          "prose prose-sm max-w-none text-2xs text-ink leading-relaxed",
          "[&_p]:my-1 [&_p]:text-2xs [&_p]:text-ink",
          "[&_h2]:text-2xs [&_h2]:font-semibold [&_h2]:mt-1 [&_h2]:mb-0.5",
          "[&_h3]:text-2xs [&_h3]:font-semibold [&_h3]:mt-1 [&_h3]:mb-0",
          "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-2xs [&_ul]:pl-4 [&_ol]:pl-4 [&_ul]:list-disc [&_ol]:list-decimal",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
          "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[10px] [&_code]:font-mono"
        )}
        // Server-side sanitization happened on insert; safe to render.
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
    </li>
  );
}
