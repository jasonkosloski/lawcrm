/**
 * Deadline status + kind constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Deadline.status / Deadline.kind value sets.
 * `src/lib/note-constants.ts` re-exports these for its long-standing
 * importers; new code should import from here.
 *
 * Note on "overdue": the schema documents it as a stored status, but
 * app code treats overdue as DERIVED (status "open" + dueDate in the
 * past — see matter-detail's isOverdue and notification-sweeps). The
 * settable set below therefore excludes it; the label map includes it
 * so legacy/seed rows that carry it still render properly.
 */

/// Statuses a user can set through the UI / actions (zod-validated).
export const DEADLINE_STATUSES = ["open", "completed", "waived"] as const;

export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

/// Every status value that can appear on a row, settable or derived.
export const ALL_DEADLINE_STATUSES = [
  "open",
  "completed",
  "overdue",
  "waived",
] as const;

export const DEADLINE_STATUS_LABEL: Record<
  (typeof ALL_DEADLINE_STATUSES)[number],
  string
> = {
  open: "Open",
  completed: "Completed",
  overdue: "Overdue",
  waived: "Waived",
};

export const DEADLINE_KINDS = ["critical", "auto_rule", "manual"] as const;

export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  critical: "Critical",
  auto_rule: "Auto-rule",
  manual: "Manual",
};
