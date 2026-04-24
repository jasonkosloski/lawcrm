/**
 * Matter Detail — Tasks tab
 *
 * Task checklist grouped by status (Open / In progress / In review /
 * Done). Each task shows priority, due date, and owner.
 */

import { Card, CardContent } from "@/components/ui/card";
import { TabAddButton } from "@/components/matters/tab-add-button";
import {
  getMatterTasks,
  type TaskRow,
} from "@/lib/queries/matter-detail";

const STATUS_ORDER = ["open", "in_progress", "in_review", "done", "cancelled"];

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

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

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default async function MatterTasksPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const tasks = await getMatterTasks(id);

  if (tasks.length === 0) {
    return (
      <div className="p-5">
        <Card>
          <CardContent className="p-8 text-center flex flex-col items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-ink mb-1">
                No tasks yet
              </div>
              <div className="text-xs text-ink-3">
                Task checklist for this matter — assignments, due dates, and
                priorities — will appear here.
              </div>
            </div>
            <TabAddButton type="task" />
          </CardContent>
        </Card>
      </div>
    );
  }

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
                  <TaskItem key={t.id} task={t} />
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function TaskItem({ task }: { task: TaskRow }) {
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.normal;
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        className={
          "inline-block w-3.5 h-3.5 rounded-full border shrink-0 " +
          (done
            ? "bg-ok border-ok"
            : task.status === "in_progress"
              ? "border-brand-500 bg-brand-50"
              : "border-line")
        }
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
      </div>
      <span
        className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${priority.className}`}
      >
        {priority.label}
      </span>
      <span className="text-2xs font-mono text-ink-4 w-16 text-right shrink-0">
        {task.dueDate
          ? task.daysUntilDue !== null && task.daysUntilDue <= 7 && !done
            ? task.daysUntilDue < 0
              ? `${Math.abs(task.daysUntilDue)}d late`
              : `${task.daysUntilDue}d`
            : formatDate(task.dueDate)
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
    </li>
  );
}
