/**
 * Notifications writer — server-only.
 *
 * Single chokepoint for "tell user X about event Y." Server actions
 * call `createNotification()` after they finish their primary work
 * (the same shape as `logActivity` for the audit log). The bell UI
 * in the topbar reads the unread count + recent unread; the writer
 * is fire-and-forget on errors so a failed notification write never
 * rolls back the underlying mutation.
 *
 * Future: when we add email / SMS / push delivery, those channels
 * fan out FROM this helper rather than each action knowing about
 * them. The Notification row stays the source of truth for the
 * in-app surface; delivery to other channels is a separate worker
 * reading the same table.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export type NotificationType =
  /** Task assigned to the recipient (ownerId set on creation). */
  | "task_assigned"
  /** Task with an upcoming due date (within firm-wide window). */
  | "task_due_soon"
  /** Deadline approaching (computed by the cron / scheduled job). */
  | "deadline_approaching"
  /** Deadline already past due. */
  | "deadline_overdue"
  /** Settlement approval step status changed (recipient = approver). */
  | "settlement_step_approved"
  | "settlement_step_rejected"
  /** Payment recorded against a matter the recipient leads. */
  | "invoice_payment_recorded"
  /** Recipient was named in a note (mention shape — future work). */
  | "note_mentioned"
  /** Recipient was added to a matter's team. */
  | "matter_assigned"
  /** Catch-all for callsites that don't fit a specific bucket. */
  | "generic";

export type CreateNotificationInput = {
  /** The recipient. Each (user, event) pair is a separate row. */
  userId: string;
  type: NotificationType;
  /** Headline copy — short. Renders as the row's primary line. */
  title: string;
  /** Optional secondary line. */
  body?: string | null;
  /** Optional click target. Bell rows that lack a link render as
   *  pure heads-up (no navigation chevron). */
  link?: string | null;
  /** Optional matter scope so future per-matter notification
   *  preferences can filter. */
  matterId?: string | null;
};

/**
 * Persist a single notification + revalidate the topbar so the
 * bell badge picks up the new unread count on the next render.
 *
 * Fire-and-forget on failure — the audit log and the user's
 * primary action remain authoritative; observability never blocks
 * the source of truth.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        matterId: input.matterId ?? null,
      },
    });
    // The bell lives in the dashboard layout — revalidate the whole
    // tree so the badge count refreshes without a full reload.
    revalidatePath("/", "layout");
  } catch (err) {
    console.warn("[notifications] failed to write notification", err);
  }
}

/**
 * Fan out a notification to multiple recipients. Used by triggers
 * like "settlement step approved" where every matter team member
 * with the right role should hear about it. Duplicate recipient
 * ids are collapsed to one row each — but this helper doesn't know
 * who the acting user is, so callers must filter the actor out of
 * `recipients` themselves (see the payment fan-out in
 * `src/app/actions/billing.ts`) unless self-notifying is intended.
 */
export async function createNotifications(
  recipients: readonly string[],
  shape: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  if (recipients.length === 0) return;
  const dedup = Array.from(new Set(recipients));
  try {
    await prisma.notification.createMany({
      data: dedup.map((userId) => ({
        userId,
        type: shape.type,
        title: shape.title,
        body: shape.body ?? null,
        link: shape.link ?? null,
        matterId: shape.matterId ?? null,
      })),
    });
    revalidatePath("/", "layout");
  } catch (err) {
    console.warn("[notifications] failed to fan out notification", err);
  }
}
