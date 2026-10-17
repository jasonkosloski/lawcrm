/**
 * Activity log writer.
 *
 * One small helper used by every server action that creates a Note /
 * Task / Deadline / TimeEntry / Event so the dashboard "Recent
 * activity" card reflects real user activity (not just seed data).
 *
 * Fire-and-forget on errors: a failed activity write should never
 * roll back the underlying create. We just swallow + console.warn so
 * the action stays the user's source of truth.
 *
 * Governance and money events (password resets, role/permission
 * changes, conflict overrides, trust and payment recording) should
 * NOT be fire-and-forget: use `logActivityTx` inside the mutation's
 * `$transaction` so the audit row and the change commit or roll back
 * together.
 *
 * Type / icon / source values match the schema's documented enums and
 * the dashboard's `ACTIVITY_ICONS` map.
 */

import { revalidatePath } from "next/cache";
import { prisma, type Tx } from "@/lib/prisma";

export type ActivityType =
  | "note"
  | "task"
  | "task_complete"
  | "deadline"
  | "time_entry"
  | "event"
  | "filing"
  | "email"
  | "call"
  | "evidence"
  | "deposition"
  | "settlement"
  | "deposit"
  | "automation"
  | "document"
  /** Sign-in / password events (src/lib/auth-events.ts writes most of
   *  them). Firm-wide, shown under "Security" on /settings/activity,
   *  excluded from the dashboard feed. */
  | "auth";

export type ActivityInput = {
  matterId: string | null;
  userId: string;
  type: ActivityType;
  title: string;
  detail?: string | null;
  icon?: string;
  source?: string;
};

const toRow = (input: ActivityInput) => ({
  matterId: input.matterId,
  userId: input.userId,
  type: input.type,
  title: input.title,
  detail: input.detail ?? null,
  icon: input.icon ?? defaultIconFor(input.type),
  source: input.source ?? defaultSourceFor(input.type),
});

/**
 * Transactional variant for audit-critical events: writes the row on
 * the caller's transaction client and LETS ERRORS PROPAGATE, so a
 * failed audit write rolls the mutation back instead of leaving a
 * committed change with no record. Does not revalidate (call
 * `revalidatePath` after the transaction commits if the dashboard
 * feed should refresh).
 *
 *   await prisma.$transaction(async (tx) => {
 *     await tx.user.update(...);
 *     await logActivityTx(tx, { ... });
 *   });
 */
export async function logActivityTx(
  tx: Tx,
  input: ActivityInput
): Promise<void> {
  await tx.activityLog.create({ data: toRow(input) });
}

export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({ data: toRow(input) });
    // Dashboard "Recent activity" reads from this table on every
    // request — refresh it so a just-logged entry shows up the next
    // time the user lands on /.
    revalidatePath("/");
  } catch (err) {
    // Activity log is observability — never block the underlying
    // user action if the log write fails.
    console.warn("[activity-log] failed to write entry", err);
  }
}

function defaultIconFor(type: ActivityType): string {
  switch (type) {
    case "note":
      return "note";
    case "task":
    case "task_complete":
      return "check";
    case "deadline":
      return "gavel";
    case "time_entry":
      return "clock";
    case "event":
      return "video";
    case "email":
      return "mail";
    case "call":
      return "phone";
    case "document":
    case "filing":
      return "document";
    case "auth":
      return "shield";
    default:
      return "zap";
  }
}

function defaultSourceFor(type: ActivityType): string {
  switch (type) {
    case "note":
      return "Notes";
    case "task":
    case "task_complete":
      return "Tasks";
    case "deadline":
      return "Deadlines";
    case "time_entry":
      return "Time";
    case "event":
      return "Calendar";
    case "email":
      return "Email";
    case "call":
      return "Phone";
    case "document":
    case "filing":
      return "Documents";
    case "auth":
      return "Security";
    default:
      return "System";
  }
}
