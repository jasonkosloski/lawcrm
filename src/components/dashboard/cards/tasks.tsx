import { CheckCircle2 } from "lucide-react";
import { DashboardTaskRow } from "@/components/tasks/dashboard-task-row";
import { formatDateOnly } from "@/lib/format-date";
import type { MyTaskItem, MyTasksGrouped } from "@/lib/queries/dashboard";
import { DashboardCard } from "../dashboard-card";

/** Format a task's due date as a short relative or absolute label. */
const formatTaskDue = (task: MyTaskItem): string => {
  if (task.dueDate === null || task.daysUntilDue === null) return "—";
  if (task.daysUntilDue < 0) return `${Math.abs(task.daysUntilDue)}d late`;
  if (task.daysUntilDue === 0) return "today";
  if (task.daysUntilDue === 1) return "tomorrow";
  if (task.daysUntilDue <= 7) return `${task.daysUntilDue}d`;
  // Date-only value (ADR-012): read in UTC, never shifted by a zone.
  return formatDateOnly(task.dueDate, "short");
};

/**
 * One bucket of tasks (Overdue / Today / This week / etc.). Renders
 * nothing when empty. Row markup + per-task kebab live in
 * `DashboardTaskRow` so this stays server-rendered.
 */
function TaskGroup({
  label,
  tone,
  tasks,
}: {
  label: string;
  tone: "warn" | "brand" | "muted";
  tasks: MyTaskItem[];
}) {
  if (tasks.length === 0) return null;
  const labelClass = tone === "warn" ? "text-danger" : tone === "brand" ? "text-ink" : "text-ink-3";
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className={`text-xs font-semibold ${labelClass}`}>{label}</span>
        <span className="text-2xs text-ink-4 tabular-nums">{tasks.length}</span>
      </div>
      <div className="flex flex-col">
        {tasks.map((t) => (
          <DashboardTaskRow
            key={t.id}
            id={t.id}
            title={t.title}
            priority={t.priority}
            matterId={t.matterId}
            leadId={t.leadId}
            matterName={t.matterName}
            daysUntilDue={t.daysUntilDue}
            dueDate={t.dueDate}
            dueLabel={formatTaskDue(t)}
          />
        ))}
      </div>
    </div>
  );
}

export function TasksCard({ tasks }: { tasks: MyTasksGrouped }) {
  return (
    <DashboardCard
      title="Your tasks"
      count={tasks.total}
      warn={tasks.overdueCount > 0 ? `${tasks.overdueCount} overdue` : undefined}
      empty={
        tasks.total === 0
          ? { icon: CheckCircle2, text: "Nothing on your plate. Inbox zero." }
          : null
      }
    >
      <div className="flex flex-col gap-3">
        <TaskGroup label="Overdue" tone="warn" tasks={tasks.overdue} />
        <TaskGroup label="Today" tone="brand" tasks={tasks.today} />
        <TaskGroup label="This week" tone="muted" tasks={tasks.thisWeek} />
        <TaskGroup label="Later" tone="muted" tasks={tasks.later} />
        <TaskGroup label="No due date" tone="muted" tasks={tasks.noDueDate} />
        {tasks.hidden > 0 && (
          <div className="text-2xs text-ink-4">+{tasks.hidden} more not shown</div>
        )}
      </div>
    </DashboardCard>
  );
}
