/**
 * Deadline server actions — update, delete, status toggle.
 *
 * Mirrors the task-actions pattern. Status `overdue` is computed at
 * read time from `dueDate` vs now, so we don't write it here — only
 * the user-driven states (open / completed / waived) are settable.
 *
 * Auth: gated on `deadlines.edit` (status + field edits) and
 * `deadlines.delete`. Admins short-circuit; other roles need
 * explicit grant via the matrix.
 *
 * Statute of limitations: the Matter SOL fields are authoritative and
 * the auto-managed SOL Deadline (sourceType `statute_of_limitations`)
 * is a mirror of them. These actions therefore refuse to move or
 * delete that row (the date is changed from the matter edit page);
 * status changes stay allowed. Every successful mutation is written
 * to the activity log with the old and new values.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  type DeadlineStatus,
} from "@/lib/constants/deadline-status";
import type { UpdateDeadlineFormState } from "@/lib/deadline-form";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { SOL_SOURCE_TYPE } from "@/lib/sol";

const SOL_MANAGED_MESSAGE =
  "The statute of limitations is managed on the matter. Change or clear it from the matter's Edit page.";

/** `YYYY-MM-DD` in the server's local zone — the frame
 *  `parseLocalDueDate` parses deadline due dates in. Used only for
 *  audit-log wording. */
function dayLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const STATUS_LOG_TITLE: Record<string, string> = {
  completed: "Deadline completed",
  waived: "Deadline waived",
  open: "Deadline reopened",
  overdue: "Deadline marked overdue",
};

function revalidateForDeadline(matterId: string): void {
  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/"); // dashboard "Deadlines this week" card
  revalidatePath("/calendar");
}

// ── Status ──────────────────────────────────────────────────────────────

export async function setDeadlineStatus(
  deadlineId: string,
  status: DeadlineStatus
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("deadlines.edit");
  if (!(DEADLINE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true, status: true, title: true, dueDate: true },
  });
  if (!deadline) return { ok: false, error: "Deadline not found" };

  const isComplete = status === "completed";
  const wasComplete = deadline.status === "completed";

  await prisma.deadline.update({
    where: { id: deadlineId },
    data: {
      status,
      completedAt: isComplete
        ? wasComplete
          ? undefined
          : new Date()
        : null,
    },
  });

  if (deadline.status !== status) {
    await logActivity({
      matterId: deadline.matterId,
      userId,
      type: "deadline",
      title: STATUS_LOG_TITLE[status] ?? "Deadline status changed",
      detail: `${deadline.title} (due ${dayLabel(deadline.dueDate)}): ${deadline.status} → ${status}`,
    });
  }

  revalidateForDeadline(deadline.matterId);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeadline(
  deadlineId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("deadlines.delete");
  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: {
      matterId: true,
      title: true,
      dueDate: true,
      sourceType: true,
    },
  });
  if (!deadline) return { ok: false, error: "Deadline not found" };
  if (deadline.sourceType === SOL_SOURCE_TYPE) {
    return { ok: false, error: SOL_MANAGED_MESSAGE };
  }

  await prisma.deadline.delete({ where: { id: deadlineId } });

  // Title + date captured before the delete — the row is gone now.
  await logActivity({
    matterId: deadline.matterId,
    userId,
    type: "deadline",
    title: "Deadline deleted",
    detail: `${deadline.title} (was due ${dayLabel(deadline.dueDate)})`,
  });

  revalidateForDeadline(deadline.matterId);
  return { ok: true };
}

// ── Update ──────────────────────────────────────────────────────────────

/** Parse the form's dueDate field (`YYYY-MM-DD` from `<input type="date">`)
 *  into local midnight of that day.
 *
 *  We don't use `new Date(value)` directly because that parses ISO
 *  date-only strings as UTC midnight, which shifts the day for any
 *  user west of UTC — and since the edit dialog reads the value back
 *  with local getters, each save would drift the deadline a day
 *  earlier. Mirrors parseEventBoundary (calendar-events.ts) and
 *  parseEndOfDay (follow-ups.ts).
 *
 *  Returns null when the value can't be parsed (caller surfaces
 *  the field error). */
function parseLocalDueDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True when `posted` (YYYY-MM-DD) is the stored UTC-midnight day or one
 *  day either side of it — the spread a browser's local-time read-back
 *  can introduce. */
function isSolDayUnchanged(posted: string, stored: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(posted);
  if (!m) return false;
  const postedMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const storedMs = Date.UTC(
    stored.getUTCFullYear(),
    stored.getUTCMonth(),
    stored.getUTCDate()
  );
  return Math.abs(postedMs - storedMs) <= 24 * 60 * 60 * 1000;
}

const updateDeadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string().min(1, "Due date is required"),
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  sourceRef: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(4000).optional().or(z.literal("")),
  status: z.enum(DEADLINE_STATUSES).default("open"),
});

export async function updateDeadline(
  deadlineId: string,
  _prev: UpdateDeadlineFormState,
  formData: FormData
): Promise<UpdateDeadlineFormState> {
  const userId = await requirePermission("deadlines.edit");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateDeadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: {
      matterId: true,
      status: true,
      title: true,
      dueDate: true,
      kind: true,
      sourceType: true,
    },
  });
  if (!deadline) {
    return {
      status: "error",
      errors: { title: ["Deadline no longer exists"] },
    };
  }

  const newStatus = parsed.data.status;
  const isComplete = newStatus === "completed";
  const wasComplete = deadline.status === "completed";
  const completedAt = isComplete ? (wasComplete ? undefined : new Date()) : null;

  const isSol = deadline.sourceType === SOL_SOURCE_TYPE;
  if (isSol) {
    // The SOL row mirrors the matter's SOL fields, so only the status
    // is editable here; the matter owns the rest and would overwrite
    // it on its next save. The dialog renders the date read-only but
    // still posts it, read back with BROWSER-local getters from the
    // UTC-midnight storage, so a browser west of UTC posts the
    // previous day. Accept the stored UTC day +/- 1 (covers every
    // real UTC offset, independent of the server's TZ) as "unchanged";
    // refuse anything further away as an attempted move.
    if (!isSolDayUnchanged(parsed.data.dueDate, deadline.dueDate)) {
      return {
        status: "error",
        errors: { dueDate: [SOL_MANAGED_MESSAGE] },
      };
    }
    await prisma.deadline.update({
      where: { id: deadlineId },
      data: { status: newStatus, completedAt },
    });
    if (deadline.status !== newStatus) {
      await logActivity({
        matterId: deadline.matterId,
        userId,
        type: "deadline",
        title: STATUS_LOG_TITLE[newStatus] ?? "Deadline status changed",
        detail: `${deadline.title} (due ${dayLabel(deadline.dueDate)}): ${deadline.status} → ${newStatus}`,
      });
    }
    revalidateForDeadline(deadline.matterId);
    return { status: "ok" };
  }

  const dueDate = parseLocalDueDate(parsed.data.dueDate);
  if (!dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
    };
  }

  await prisma.deadline.update({
    where: { id: deadlineId },
    data: {
      title: parsed.data.title,
      dueDate,
      kind: parsed.data.kind,
      sourceRef: parsed.data.sourceRef || null,
      description: parsed.data.description || null,
      status: newStatus,
      completedAt,
    },
  });

  // Audit: only what actually changed, with old -> new.
  const oldDay = dayLabel(deadline.dueDate);
  const newDay = dayLabel(dueDate);
  const changes: string[] = [];
  if (parsed.data.title !== deadline.title) {
    changes.push(`title "${deadline.title}" → "${parsed.data.title}"`);
  }
  if (oldDay !== newDay) changes.push(`due ${oldDay} → ${newDay}`);
  if (parsed.data.kind !== deadline.kind) {
    changes.push(`kind ${deadline.kind} → ${parsed.data.kind}`);
  }
  if (newStatus !== deadline.status) {
    changes.push(`status ${deadline.status} → ${newStatus}`);
  }
  if (changes.length > 0) {
    await logActivity({
      matterId: deadline.matterId,
      userId,
      type: "deadline",
      title:
        oldDay !== newDay
          ? "Deadline rescheduled"
          : newStatus !== deadline.status
            ? (STATUS_LOG_TITLE[newStatus] ?? "Deadline updated")
            : "Deadline updated",
      detail: `${parsed.data.title}: ${changes.join("; ")}`,
    });
  }

  revalidateForDeadline(deadline.matterId);
  return { status: "ok" };
}
