/**
 * Task status constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Task.status value set (see the schema doc
 * comment on Task). `src/lib/note-constants.ts` re-exports these for
 * its long-standing importers; new code should import from here.
 */

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/// Statuses that mean "this task is finished" — nothing further is
/// expected. Drives the completedAt stamp + strike-through styling.
export const TASK_CLOSED_STATUSES = [
  "done",
  "cancelled",
] as const satisfies readonly TaskStatus[];

export function isTaskClosed(status: string): boolean {
  return (TASK_CLOSED_STATUSES as readonly string[]).includes(status);
}
