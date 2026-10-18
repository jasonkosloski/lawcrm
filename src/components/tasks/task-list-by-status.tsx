/**
 * Task list grouped by status (Open / In progress / In review / Done)
 * — the body of the matter and intake Tasks tabs. Each row shows
 * priority, due date and owner, with the status toggle and row menu
 * gated by the viewer's `perms`.
 *
 * Due dates are date-only values (ADR-012): displayed with
 * `formatDateOnly`, and "days left" is counted from the VIEWER's today
 * with `daysUntilDateOnly` — a task due today is "Today", never late.
 *
 * `matterId` null = an intake lead's tasks: no spawn-source chips or
 * attached notes (the page also turns off the matter-only row actions).
 */

import { Card } from "@/components/ui/card";
import {
  TaskRowMenu,
  TaskStatusToggle,
} from "@/components/tasks/task-row-actions";
import { EntitySourceChip } from "@/components/matters/entity-source-chip";
import { RowAttachedNotes } from "@/components/matters/row-attached-notes";
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type TaskStatus,
} from "@/lib/constants/task-status";
import type { TaskRow } from "@/lib/queries/matter-detail";
import type { AssigneeOption } from "@/lib/queries/team";
import {
  dateOnlyKey,
  daysUntilDateOnly,
  formatDateOnly,
} from "@/lib/format-date";

// Ordering follows the canonical status list; labels are centralized
// (src/lib/constants/task-status.ts). Widened to string-indexable
// because DB values arrive untyped.
const STATUS_ORDER: readonly string[] = TASK_STATUSES;
const STATUS_LABEL: Record<string, string> = TASK_STATUS_LABEL;

const PRIORITY_META: Record<
  string,
  { label: string; className: string }
> = {
  urgent: {
    label: "Urgent",
    className: "bg-warn-soft text-warn border-warn-border",
  },
  high: {
    label: "High",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  normal: {
    label: "Normal",
    className: "bg-paper-2 text-ink-3 border-line",
  },
  low: {
    label: "Low",
    className: "bg-paper-2 text-ink-4 border-line",
  },
};

/** What the viewer may do with the rows (resolved once by the page). */
export type TaskRowPerms = {
  canEdit: boolean;
  canDelete: boolean;
  canLogTime: boolean;
  canAddNote: boolean;
  canConvert: boolean;
};

export function TaskListByStatus({
  tasks,
  matterId,
  assignees,
  tz,
  updatedAtById,
  perms,
}: {
  tasks: TaskRow[];
  matterId: string | null;
  assignees: AssigneeOption[];
  tz: string;
  /** Row versions (ISO) for the edit dialog's stale-form guard. */
  updatedAtById: Map<string, string>;
  perms: TaskRowPerms;
}) {
  // Group by status
  const byStatus = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    if (!byStatus.has(t.status)) byStatus.set(t.status, []);
    byStatus.get(t.status)!.push(t);
  }
  const orderedStatuses = [
    ...STATUS_ORDER.filter((s) => byStatus.has(s)),
    ...[...byStatus.keys()].filter((s) => !STATUS_ORDER.includes(s)),
  ];

  return (
    <>
      {orderedStatuses.map((status) => {
      const rows = byStatus.get(status)!;
      return (
        <section key={status}>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              {STATUS_LABEL[status] ?? status}
            </h2>
            <span className="text-2xs font-mono text-ink-4">
              {rows.length}
            </span>
          </div>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {rows.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  matterId={matterId}
                  assignees={assignees}
                  tz={tz}
                  updatedAt={updatedAtById.get(t.id) ?? ""}
                  perms={perms}
                />
              ))}
            </ul>
          </Card>
        </section>
      );
    })}
    </>
  );
}

function TaskItem({
  task,
  matterId,
  assignees,
  tz,
  updatedAt,
  perms,
}: {
  task: TaskRow;
  /** Null on an intake (lead) task: no spawn-source chip or attached
   *  notes (lead tasks have neither). */
  matterId: string | null;
  assignees: AssigneeOption[];
  tz: string;
  updatedAt: string;
  perms: TaskRowPerms;
}) {
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.normal;
  const done = task.status === "done" || task.status === "cancelled";
  // Whole days from the viewer's today (0 = due today, <0 = late).
  const daysLeft = task.dueDate ? daysUntilDateOnly(task.dueDate, tz) : null;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 group">
      <TaskStatusToggle
        taskId={task.id}
        status={task.status as TaskStatus}
        canEdit={perms.canEdit}
      />
      <div className="flex-1 min-w-0">
        <div
          className={
            "text-xs " +
            (done ? "text-ink-3 line-through" : "font-medium text-ink")
          }
        >
          {task.title}
        </div>
        {task.description && (
          <div className="text-2xs text-ink-3 truncate max-w-xl">
            {task.description}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
          {matterId && task.spawnedFrom && (
            <EntitySourceChip
              source={task.spawnedFrom}
              matterId={matterId}
            />
          )}
          {matterId && (
            <RowAttachedNotes notes={task.attachedNotes} matterId={matterId} />
          )}
        </div>
      </div>
      <span
        className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${priority.className}`}
      >
        {priority.label}
      </span>
      <span className="text-2xs font-mono text-ink-4 w-16 text-right shrink-0">
        {task.dueDate && daysLeft !== null
          ? daysLeft <= 7 && !done
            ? daysLeft < 0
              ? `${Math.abs(daysLeft)}d late`
              : daysLeft === 0
                ? "Today"
                : `${daysLeft}d`
            : formatDateOnly(task.dueDate, "short")
          : "—"}
      </span>
      <span className="w-6 shrink-0 text-right">
        {task.ownerInitials ? (
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100"
            title={task.ownerName ?? undefined}
          >
            {task.ownerInitials}
          </span>
        ) : (
          <span className="text-2xs text-ink-4">—</span>
        )}
      </span>
      <TaskRowMenu
        task={{
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status as TaskStatus,
          ownerId: task.ownerId,
          ownerName: task.ownerName,
          ownerInitials: task.ownerInitials,
          dueDateKey: task.dueDate ? dateOnlyKey(task.dueDate) : "",
          updatedAt,
        }}
        assignees={assignees}
        {...perms}
      />
    </li>
  );
}
