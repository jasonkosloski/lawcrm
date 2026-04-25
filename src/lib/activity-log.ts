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
 * Type / icon / source values match the schema's documented enums and
 * the dashboard's `ACTIVITY_ICONS` map.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export type ActivityType =
  | "note"
  | "task"
  | "task_complete"
  | "deadline"
  | "time_entry"
  | "event"
  | "filing"
  | "email"
  | "evidence"
  | "deposition"
  | "settlement"
  | "deposit"
  | "automation"
  | "document";

export async function logActivity(input: {
  matterId: string | null;
  userId: string;
  type: ActivityType;
  title: string;
  detail?: string | null;
  icon?: string;
  source?: string;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        matterId: input.matterId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
        icon: input.icon ?? defaultIconFor(input.type),
        source: input.source ?? defaultSourceFor(input.type),
      },
    });
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
    case "document":
    case "filing":
      return "document";
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
    case "document":
    case "filing":
      return "Documents";
    default:
      return "System";
  }
}
