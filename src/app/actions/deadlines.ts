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
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  type DeadlineStatus,
} from "@/lib/note-constants";
import type { UpdateDeadlineFormState } from "@/lib/deadline-form";
import { requirePermission } from "@/lib/permission-check";

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
  await requirePermission("deadlines.edit");
  if (!(DEADLINE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true, status: true },
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

  revalidateForDeadline(deadline.matterId);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeadline(
  deadlineId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("deadlines.delete");
  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true },
  });
  if (!deadline) return { ok: false, error: "Deadline not found" };

  await prisma.deadline.delete({ where: { id: deadlineId } });

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
  await requirePermission("deadlines.edit");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateDeadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const dueDate = parseLocalDueDate(parsed.data.dueDate);
  if (!dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
    };
  }

  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true, status: true },
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

  await prisma.deadline.update({
    where: { id: deadlineId },
    data: {
      title: parsed.data.title,
      dueDate,
      kind: parsed.data.kind,
      sourceRef: parsed.data.sourceRef || null,
      description: parsed.data.description || null,
      status: newStatus,
      completedAt: isComplete
        ? wasComplete
          ? undefined
          : new Date()
        : null,
    },
  });

  revalidateForDeadline(deadline.matterId);
  return { status: "ok" };
}
