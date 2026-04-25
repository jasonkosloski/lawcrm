/**
 * Note Attachments Section — what's attached to a saved note.
 *
 * Renders below the note content (above reactions). Three categories:
 *   - Tasks → compact chip row, status + priority colored
 *   - Deadlines → compact chip row, kind + days-until colored
 *   - Time entries → mini-card list mirroring EventTimeEntriesSection
 *     so the design language stays cohesive across the app.
 *
 * Below the categories, three "Add" buttons collapse to a single
 * row when nothing is being composed; clicking one expands its
 * dedicated inline form. Only one composer is open at a time.
 *
 * The whole section hides when there's nothing attached AND the
 * composer is collapsed — applies on reply notes so threads don't
 * fill with "+ Add task" rows on every leaf.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CircleAlert,
  Clock,
  ListTodo,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteTimeEntry } from "@/app/actions/time-entries";
import { deleteTask } from "@/app/actions/tasks";
import { deleteDeadline } from "@/app/actions/deadlines";
import type {
  NoteAttachedDeadline,
  NoteAttachedTask,
  NoteAttachedTimeEntry,
} from "@/lib/queries/matter-detail";
import {
  AddDeadlineForm,
  AddTaskForm,
  AddTimeEntryForm,
} from "./note-attachment-forms";

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

type ComposerKind = "task" | "deadline" | "time" | null;

export function NoteAttachmentsSection({
  noteId,
  matterId,
  /** When true, hides the "+ Add" affordances when nothing is attached
   *  yet — keeps reply notes uncluttered. */
  compact = false,
  tasks,
  deadlines,
  timeEntries,
}: {
  noteId: string;
  matterId: string;
  compact?: boolean;
  tasks: NoteAttachedTask[];
  deadlines: NoteAttachedDeadline[];
  timeEntries: NoteAttachedTimeEntry[];
}) {
  const [composer, setComposer] = useState<ComposerKind>(null);
  const hasAny =
    tasks.length > 0 || deadlines.length > 0 || timeEntries.length > 0;

  // Compact-mode collapse: when there's nothing here AND no composer
  // is open, render nothing so reply notes stay tidy.
  if (compact && !hasAny && composer === null) return null;

  return (
    <div className="mt-3 pt-3 border-t border-line flex flex-col gap-2">
      {tasks.length > 0 && (
        <ChipRow label="Tasks" count={tasks.length}>
          {tasks.map((t) => (
            <TaskChip
              key={t.id}
              task={t}
              href={`/matters/${matterId}/tasks`}
            />
          ))}
        </ChipRow>
      )}

      {deadlines.length > 0 && (
        <ChipRow label="Deadlines" count={deadlines.length}>
          {deadlines.map((d) => (
            <DeadlineChip
              key={d.id}
              deadline={d}
              href={`/matters/${matterId}/deadlines`}
            />
          ))}
        </ChipRow>
      )}

      {timeEntries.length > 0 && (
        <TimeEntriesGroup
          entries={timeEntries}
          matterId={matterId}
        />
      )}

      {composer === null ? (
        <AddButtonRow onPick={setComposer} />
      ) : composer === "task" ? (
        <AddTaskForm
          noteId={noteId}
          onCancel={() => setComposer(null)}
          onSaved={() => setComposer(null)}
        />
      ) : composer === "deadline" ? (
        <AddDeadlineForm
          noteId={noteId}
          onCancel={() => setComposer(null)}
          onSaved={() => setComposer(null)}
        />
      ) : (
        <AddTimeEntryForm
          noteId={noteId}
          onCancel={() => setComposer(null)}
          onSaved={() => setComposer(null)}
        />
      )}
    </div>
  );
}

// ── Chip rows ──────────────────────────────────────────────────────────

function ChipRow({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        {label} ({count})
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const TASK_PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-warn",
  high: "bg-brand-500",
  normal: "bg-ink-4",
  low: "bg-line",
};

function TaskChip({
  task,
  href,
}: {
  task: NoteAttachedTask;
  href: string;
}) {
  const [pending, startTransition] = useTransition();
  const done = task.status === "done" || task.status === "cancelled";

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${task.title}"?`)) return;
    startTransition(async () => {
      await deleteTask(task.id);
    });
  };

  return (
    <Link
      href={href}
      title={task.title}
      className={cn(
        "group/chip inline-flex items-center gap-1.5 max-w-full text-2xs px-2 py-1 rounded-md border bg-paper-2/60 border-line",
        "hover:border-brand-300 hover:bg-brand-soft transition-colors",
        done && "opacity-60",
        pending && "opacity-40"
      )}
    >
      <ListTodo size={10} className="shrink-0 text-ink-4" />
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          TASK_PRIORITY_DOT[task.priority] ?? TASK_PRIORITY_DOT.normal
        )}
      />
      <span
        className={cn(
          "truncate text-ink-2",
          done && "line-through text-ink-4"
        )}
      >
        {task.title}
      </span>
      {task.dueDate && (
        <span className="font-mono text-ink-4 shrink-0">
          {formatDate(task.dueDate)}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        title="Delete task"
        aria-label="Delete task"
        className="ml-0.5 text-ink-4 hover:text-warn opacity-0 group-hover/chip:opacity-100 transition-opacity"
      >
        <Trash2 size={10} />
      </button>
    </Link>
  );
}

function DeadlineChip({
  deadline,
  href,
}: {
  deadline: NoteAttachedDeadline;
  href: string;
}) {
  const [pending, startTransition] = useTransition();
  const isOverdue =
    deadline.status === "open" && deadline.dueDate.getTime() < Date.now();
  const isCritical = deadline.kind === "critical";
  const done = deadline.status === "completed" || deadline.status === "waived";

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${deadline.title}"?`)) return;
    startTransition(async () => {
      await deleteDeadline(deadline.id);
    });
  };

  return (
    <Link
      href={href}
      title={deadline.title}
      className={cn(
        "group/chip inline-flex items-center gap-1.5 max-w-full text-2xs px-2 py-1 rounded-md border transition-colors",
        isOverdue
          ? "bg-warn-soft border-warn-border text-warn hover:bg-warn-soft"
          : isCritical
            ? "bg-brand-soft border-brand-200 text-brand-700 hover:border-brand-300"
            : "bg-paper-2/60 border-line text-ink-2 hover:border-brand-300 hover:bg-brand-soft",
        done && "opacity-60",
        pending && "opacity-40"
      )}
    >
      <CircleAlert size={10} className="shrink-0" />
      <span
        className={cn(
          "truncate",
          done && "line-through"
        )}
      >
        {deadline.title}
      </span>
      <span className="font-mono shrink-0">{formatDate(deadline.dueDate)}</span>
      <button
        type="button"
        onClick={onDelete}
        title="Delete deadline"
        aria-label="Delete deadline"
        className="ml-0.5 opacity-0 group-hover/chip:opacity-100 transition-opacity hover:text-warn"
      >
        <Trash2 size={10} />
      </button>
    </Link>
  );
}

// ── Time entries (mirrors EventTimeEntriesSection layout) ──────────────

const TIME_STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  submitted: "submitted",
  billable: "billable",
  billed: "billed",
  written_off: "written off",
};

function TimeEntriesGroup({
  entries,
  matterId,
}: {
  entries: NoteAttachedTimeEntry[];
  matterId: string;
}) {
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries
    .filter((e) => e.billable && !e.noCharge)
    .reduce((s, e) => s + e.hours, 0);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Time ({entries.length})
          </div>
          <div className="text-2xs font-mono text-ink-3">
            {totalHours.toFixed(1)}h total
            {billableHours !== totalHours &&
              ` · ${billableHours.toFixed(1)}h billable`}
          </div>
        </div>
        <Link
          href={`/matters/${matterId}/time`}
          className="text-2xs text-brand-700 hover:underline"
        >
          All matter time
        </Link>
      </div>

      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <TimeEntryItem key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}

function TimeEntryItem({ entry }: { entry: NoteAttachedTimeEntry }) {
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!confirm("Delete this time entry? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteTimeEntry(entry.id);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  const mutedForBilling =
    entry.status === "billed" || entry.status === "written_off";

  return (
    <li
      className={cn(
        "rounded-md border border-line bg-paper-2/40 p-3 flex flex-col gap-1",
        pending && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
          title={entry.userName}
        >
          {entry.userInitials}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-ink truncate">
            {entry.activity}
          </span>
          {entry.privileged && (
            <span
              title="Privileged"
              className="inline-flex items-center gap-0.5 text-[10px] text-ink-4"
            >
              <Lock size={10} />
              priv
            </span>
          )}
        </div>
        <span className="font-mono text-2xs text-ink-3 shrink-0">
          {formatDate(entry.date)}
        </span>
        <span
          className={cn(
            "font-mono text-xs shrink-0",
            mutedForBilling ? "text-ink-4" : "text-ink"
          )}
        >
          {entry.hours.toFixed(1)}h
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          title={
            entry.status === "billed"
              ? "Entry is billed — unbill before deleting"
              : "Delete"
          }
          aria-label="Delete time entry"
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-3 hover:text-warn hover:bg-warn-soft transition-colors disabled:opacity-60",
            entry.status === "billed" && "opacity-40"
          )}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {entry.narrative && (
        <div className="text-2xs text-ink-3 leading-relaxed pl-8">
          {entry.narrative}
        </div>
      )}

      <div className="flex items-center gap-2 pl-8 text-[10px] text-ink-4 font-mono">
        <span>{TIME_STATUS_LABEL[entry.status] ?? entry.status}</span>
        {!entry.billable && <span>· non-billable</span>}
        {entry.noCharge && <span>· no charge</span>}
      </div>
    </li>
  );
}

// ── Add affordance ─────────────────────────────────────────────────────

function AddButtonRow({
  onPick,
}: {
  onPick: (kind: ComposerKind) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <AddPill onClick={() => onPick("task")} icon={<ListTodo size={11} />}>
        Add task
      </AddPill>
      <AddPill
        onClick={() => onPick("deadline")}
        icon={<CircleAlert size={11} />}
      >
        Add deadline
      </AddPill>
      <AddPill onClick={() => onPick("time")} icon={<Clock size={11} />}>
        Log time
      </AddPill>
    </div>
  );
}

function AddPill({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 h-7 px-2 text-2xs text-ink-3",
        "rounded-md border border-dashed border-line bg-white",
        "hover:border-brand-300 hover:text-brand-700 hover:bg-brand-soft transition-colors"
      )}
    >
      <Plus size={10} />
      {icon}
      {children}
    </button>
  );
}
