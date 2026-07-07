/**
 * Priority constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Task.priority value set. (Tasks are the
 * only prioritized entity today; if another domain grows a priority
 * column with the same values, reuse these.)
 * `src/lib/note-constants.ts` re-exports TASK_PRIORITIES for its
 * long-standing importers; new code should import from here.
 */

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
