/**
 * Dashboard "Your tasks" row.
 *
 * Wraps a `MyTaskItem` with hover-revealed actions: open the task in
 * its matter (the row is still navigable as a whole), log time on
 * the task, or add a note on it. The two dialogs are reused from the
 * matter Tasks tab so the UX is identical across surfaces.
 *
 * Implementation note: the original dashboard rendered the row as a
 * single `<Link>` wrapping the whole markup. To add a kebab we have
 * to drop the outer-link pattern (interactive-inside-interactive is
 * invalid) — instead the row is a `<div>` and the title region wraps
 * a small `<Link>` so navigation still works on the obvious target.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";
import { AddNoteOnEntityDialog } from "@/components/notes/add-note-on-entity-dialog";
import { addTimeEntryToTask } from "@/app/actions/time-on-entity";
import { addNoteToTask } from "@/app/actions/note-on-entity";

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-warn",
  high: "bg-brand-500",
  normal: "bg-ink-4",
  low: "bg-line",
};

export function DashboardTaskRow({
  id,
  title,
  priority,
  matterId,
  matterName,
  daysUntilDue,
  dueLabel,
}: {
  id: string;
  title: string;
  priority: string;
  matterId: string | null;
  matterName: string | null;
  daysUntilDue: number | null;
  /** Pre-formatted "due in 3d" / "Apr 28" / "—" string from the
   *  parent server component. Keeps formatting logic (today's date
   *  reasoning) in one place. */
  dueLabel: string;
}) {
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  const dueClass =
    daysUntilDue !== null && daysUntilDue < 0
      ? "text-warn"
      : daysUntilDue === 0
        ? "text-brand-700"
        : "text-ink-4";

  const titleNode = (
    <div className="flex-1 min-w-0">
      <div className="text-xs text-ink truncate">{title}</div>
      {matterName && (
        <div className="text-2xs text-ink-4 truncate">{matterName}</div>
      )}
    </div>
  );

  return (
    <>
      <div className="group flex items-center gap-3 py-1.5 border-b border-line last:border-b-0 -mx-2 px-2 rounded-sm hover:bg-paper-2 transition-colors">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            PRIORITY_DOT[priority] ?? PRIORITY_DOT.normal
          )}
          title={`${priority} priority`}
        />
        {matterId ? (
          <Link
            href={`/matters/${matterId}/tasks`}
            className="flex-1 min-w-0 flex items-center gap-3"
          >
            {titleNode}
          </Link>
        ) : (
          titleNode
        )}
        <span
          className={cn("text-2xs font-mono shrink-0 w-16 text-right", dueClass)}
        >
          {dueLabel}
        </span>
        {/* Kebab — only meaningful when the task lives on a matter
            (log time + add note both need a matter context). */}
        {matterId ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Task actions"
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 opacity-0 group-hover:opacity-100 hover:bg-paper-2 hover:text-ink shrink-0 transition-opacity"
                >
                  <MoreHorizontal size={14} />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onClick={() => setLogTimeOpen(true)}>
                <Clock />
                Log time on this task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddNoteOpen(true)}>
                <MessageSquarePlus />
                Add note on this task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Spacer so rows align even when the kebab is absent.
          <span className="w-6 shrink-0" />
        )}
      </div>

      <LogTimeOnEntityDialog
        open={logTimeOpen}
        onOpenChange={setLogTimeOpen}
        action={addTimeEntryToTask.bind(null, id)}
        parentLabel={title}
        parentKind="task"
      />
      <AddNoteOnEntityDialog
        open={addNoteOpen}
        onOpenChange={setAddNoteOpen}
        action={addNoteToTask.bind(null, id)}
        parentLabel={title}
        parentKind="task"
      />
    </>
  );
}
