/**
 * Matter Detail — Tasks tab
 *
 * Task checklist grouped by status (Open / In progress / In review /
 * Done). Each task shows priority, due date, and owner.
 *
 * Due dates are date-only values (ADR-012): displayed with
 * `formatDateOnly`, and "days left" is counted from the VIEWER's today
 * with `daysUntilDateOnly` — a task due today is "Today", never late.
 * Write controls follow the viewer's permissions.
 */

import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { TaskComposer } from "@/components/matters/captures/task-composer";
import { ApplyTaskListDialog } from "@/components/automations/apply-task-list-dialog";
import { listTaskLists } from "@/lib/queries/automations";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCaptureAccess } from "@/lib/capture-access";
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
import {
  getMatterTasks,
  type TaskRow,
} from "@/lib/queries/matter-detail";
import {
  listAssigneeOptions,
  type AssigneeOption,
} from "@/lib/queries/team";
import { getCurrentUserId, requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  dateOnlyKey,
  daysUntilDateOnly,
  formatDateOnly,
} from "@/lib/format-date";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";

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
type RowPerms = {
  canEdit: boolean;
  canDelete: boolean;
  canLogTime: boolean;
  canAddNote: boolean;
  canConvert: boolean;
};

export default async function MatterTasksPage({
  params,
}: PageProps<"/matters/[id]">) {
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  // Assignees feed the composer + edit-dialog pickers; the current
  // user id is the composer's default selection (self-assign).
  // The task-list library does not depend on the matter or the
  // permission result, so it runs in the same batch; it is discarded
  // below for viewers who couldn't apply a list.
  const [
    tasks,
    versions,
    assignees,
    currentUserId,
    allTaskLists,
    tz,
    canCreate,
    canEdit,
    canDelete,
    canLogTime,
    canAddNote,
    canConvert,
    captureAccess,
  ] = await Promise.all([
    getMatterTasks(id),
    // Row versions for the edit dialog's stale-form guard.
    prisma.task.findMany({
      where: { matterId: id },
      select: { id: true, updatedAt: true },
    }),
    listAssigneeOptions(),
    getCurrentUserId(),
    listTaskLists({ activeOnly: true }),
    getCurrentUserTimeZone(),
    currentUserHasPermission("tasks.create"),
    currentUserHasPermission("tasks.edit"),
    currentUserHasPermission("tasks.delete"),
    currentUserHasPermission("time_entries.create"),
    currentUserHasPermission("notes.create"),
    currentUserHasPermission("deadlines.create"),
    getCaptureAccess(),
  ]);
  const taskLists = canCreate ? allTaskLists : [];
  const updatedAtById = new Map(
    versions.map((v) => [v.id, v.updatedAt.toISOString()])
  );
  const perms: RowPerms = {
    canEdit,
    canDelete,
    canLogTime,
    canAddNote,
    canConvert,
  };

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
    <div className="p-5 flex flex-col gap-5">
      {taskLists.length > 0 && (
        <div className="flex justify-end -mb-2">
          <ApplyTaskListDialog
            matterId={id}
            lists={taskLists.map((l) => ({
              id: l.id,
              name: l.name,
              itemTitles: l.items.map((i) => i.title),
            }))}
          />
        </div>
      )}
      {canCreate && (
        <TaskComposer
          matterId={id}
          assignees={assignees}
          currentUserId={currentUserId}
          siblingKinds={captureAccess.kinds}
          canPin={captureAccess.canPin}
        />
      )}

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description={canCreate ? "Add the first one above." : undefined}
          className="py-6"
        />
      ) : null}

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
                    matterId={id}
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
    </div>
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
  matterId: string;
  assignees: AssigneeOption[];
  tz: string;
  updatedAt: string;
  perms: RowPerms;
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
          {task.spawnedFrom && (
            <EntitySourceChip
              source={task.spawnedFrom}
              matterId={matterId}
            />
          )}
          <RowAttachedNotes notes={task.attachedNotes} matterId={matterId} />
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
