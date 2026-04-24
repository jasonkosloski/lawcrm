/**
 * Single Note card with inline pin toggle + delete menu.
 *
 * Content is pre-sanitized server-side (see `src/app/actions/notes.ts`)
 * so `dangerouslySetInnerHTML` is safe here — we never render raw
 * user input that hasn't passed through DOMPurify first.
 */

"use client";

import { useTransition } from "react";
import { MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteNote, toggleNotePin } from "@/app/actions/notes";
import { NOTE_TYPE_LABEL, type NoteType } from "@/lib/note-constants";

export type NoteCardNote = {
  id: string;
  type: string;
  content: string;
  isPinned: boolean;
  authorName: string;
  authorInitials: string;
  updatedAt: Date;
};

const formatDateTime = (d: Date): string =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function NoteCard({ note }: { note: NoteCardNote }) {
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
    <Card className={cn(note.isPinned && "border-brand-200", pending && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
            title={note.authorName}
          >
            {note.authorInitials}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-ink">{note.authorName}</div>
            <div className="text-2xs text-ink-4">
              {formatDateTime(note.updatedAt)}
            </div>
          </div>
          <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-brand-soft text-brand-700 border-brand-200">
            {typeLabel}
          </span>
          <button
            type="button"
            onClick={onTogglePin}
            disabled={pending}
            title={note.isPinned ? "Unpin" : "Pin to top"}
            aria-label={note.isPinned ? "Unpin note" : "Pin note"}
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
              note.isPinned
                ? "text-brand-700 hover:bg-brand-soft"
                : "text-ink-3 hover:text-brand-700 hover:bg-brand-soft"
            )}
          >
            <Pin
              size={13}
              className={cn(note.isPinned && "fill-brand-500 text-brand-500")}
            />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Note actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-paper-2 transition-colors disabled:opacity-60"
            >
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                onClick={onDelete}
              >
                <Trash2 size={13} />
                Delete note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className={cn(
            "prose prose-sm max-w-none text-xs text-ink leading-relaxed",
            // Match the composer's content styles so reading + writing look the same.
            "[&_p]:my-1 [&_p]:text-xs [&_p]:text-ink",
            "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1",
            "[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5",
            "[&_ul]:my-1 [&_ol]:my-1 [&_li]:text-xs [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:italic",
            "[&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono",
            "[&_pre]:bg-paper-2 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[11px]"
          )}
          // Content is sanitized server-side by DOMPurify before insert.
          dangerouslySetInnerHTML={{ __html: note.content }}
        />
      </CardContent>
    </Card>
  );
}
