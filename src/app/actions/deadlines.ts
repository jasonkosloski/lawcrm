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

import { revalidateDeadlineSurfaces } from "@/lib/revalidate-deadlines";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import {
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  type DeadlineStatus,
} from "@/lib/constants/deadline-status";
import type { UpdateDeadlineFormState } from "@/lib/deadline-form";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { SOL_SOURCE_TYPE } from "@/lib/sol";
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import {
  applyRecalc,
  describeRecalc,
  previewRecalc,
  readCascadeDecision,
  type RecalcChange,
  type RecalcTrigger,
} from "@/lib/automations/recalc";

const SOL_MANAGED_MESSAGE =
  "The statute of limitations is managed on the matter. Change or clear it from the matter's Edit page.";

/** Due dates are date-only values (ADR-012): UTC midnight, read in
 *  UTC. `dayLabel` is the audit-log wording of one. */
const dayLabel = dateOnlyKey;

const STALE_MESSAGE =
  "This deadline was changed by someone else since you opened it. Close this dialog and reopen it to see the latest, then re-apply your edit.";

const STATUS_LOG_TITLE: Record<string, string> = {
  completed: "Deadline completed",
  waived: "Deadline waived",
  open: "Deadline reopened",
  overdue: "Deadline marked overdue",
};

// ── Status ──────────────────────────────────────────────────────────────

export async function setDeadlineStatus(
  deadlineId: string,
  status: DeadlineStatus,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("deadlines.edit");
  await assertChildMatterAccess("deadline", deadlineId);
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
      completedAt: isComplete ? (wasComplete ? undefined : new Date()) : null,
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

  revalidateDeadlineSurfaces(deadline.matterId);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeadline(deadlineId: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("deadlines.delete");
  await assertChildMatterAccess("deadline", deadlineId);
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

  revalidateDeadlineSurfaces(deadline.matterId);
  return { ok: true };
}

// ── Update ──────────────────────────────────────────────────────────────

const updateDeadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string().min(1, "Due date is required"),
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  sourceRef: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(4000).optional().or(z.literal("")),
  status: z.enum(DEADLINE_STATUSES).default("open"),
  /** `updatedAt` (ISO) of the row the dialog was seeded from. When
   *  present, the write only lands if the row is unchanged since —
   *  otherwise a stale form silently reverts someone else's edit
   *  (e.g. a rescheduled due date). Absent = no check. */
  expectedUpdatedAt: z.string().optional().or(z.literal("")),
});

export async function updateDeadline(
  deadlineId: string,
  _prev: UpdateDeadlineFormState,
  formData: FormData,
): Promise<UpdateDeadlineFormState> {
  const userId = await requirePermission("deadlines.edit");
  await assertChildMatterAccess("deadline", deadlineId);
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
      sourceRef: true,
      description: true,
      updatedAt: true,
      deadlineRuleId: true,
    },
  });
  if (!deadline) {
    return {
      status: "error",
      errors: { title: ["Deadline no longer exists"] },
    };
  }

  // Optimistic-concurrency guard: the dialog posts the updatedAt it
  // was seeded with. Checked here for a clear message and re-checked
  // in the write's WHERE so a race between this read and the write
  // can't slip through.
  const expected = parsed.data.expectedUpdatedAt ? new Date(parsed.data.expectedUpdatedAt) : null;
  if (expected && Number.isNaN(expected.getTime())) {
    revalidateDeadlineSurfaces(deadline.matterId);
    return { status: "error", errors: { _form: [STALE_MESSAGE] } };
  }
  if (expected && expected.getTime() !== deadline.updatedAt.getTime()) {
    revalidateDeadlineSurfaces(deadline.matterId);
    return { status: "error", errors: { _form: [STALE_MESSAGE] } };
  }
  const where = expected ? { id: deadlineId, updatedAt: expected } : { id: deadlineId };

  const newStatus = parsed.data.status;
  const isComplete = newStatus === "completed";
  const wasComplete = deadline.status === "completed";
  const completedAt = isComplete ? (wasComplete ? undefined : new Date()) : null;

  const isSol = deadline.sourceType === SOL_SOURCE_TYPE;
  if (isSol) {
    // The SOL row mirrors the matter's SOL fields, so only the status
    // is editable here; the matter owns the rest and would overwrite
    // it on its next save. The dialog renders the date read-only but
    // still posts it (the stored UTC day, ADR-012); any other day is
    // an attempted move.
    if (parsed.data.dueDate !== dateOnlyKey(deadline.dueDate)) {
      return {
        status: "error",
        errors: { dueDate: [SOL_MANAGED_MESSAGE] },
      };
    }
    const solWrite = await prisma.deadline.updateMany({
      where,
      data: { status: newStatus, completedAt },
    });
    if (solWrite.count === 0) {
      revalidateDeadlineSurfaces(deadline.matterId);
      return { status: "error", errors: { _form: [STALE_MESSAGE] } };
    }
    if (deadline.status !== newStatus) {
      await logActivity({
        matterId: deadline.matterId,
        userId,
        type: "deadline",
        title: STATUS_LOG_TITLE[newStatus] ?? "Deadline status changed",
        detail: `${deadline.title} (due ${dayLabel(deadline.dueDate)}): ${deadline.status} → ${newStatus}`,
      });
    }
    revalidateDeadlineSurfaces(deadline.matterId);
    return { status: "ok" };
  }

  const dueDate = parseDateOnly(parsed.data.dueDate);
  if (!dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
    };
  }

  // Dependent deadlines (ADR-040): a new date may move rule-generated
  // deadlines that count from this one. Never without confirmation —
  // the first submit returns the list and saves NOTHING; the dialog
  // resubmits with cascadeDecision=apply (+ the ticked cascadeIds) or
  // skip.
  const dateChanged = dateOnlyKey(dueDate) !== dateOnlyKey(deadline.dueDate);
  const trigger: RecalcTrigger = {
    kind: "deadline",
    deadlineId,
    newDueKey: dateOnlyKey(dueDate),
  };
  const { decision, selectedIds } = readCascadeDecision(formData);
  if (dateChanged && !decision) {
    const cascade = await previewRecalc(prisma, deadline.matterId, trigger);
    if (cascade.length > 0) return { status: "confirm", cascade };
  }

  let recalculated: RecalcChange[] = [];
  const saved = await prisma.$transaction(async (tx) => {
    const write = await tx.deadline.updateMany({
      where,
      data: {
        title: parsed.data.title,
        dueDate,
        kind: parsed.data.kind,
        sourceRef: parsed.data.sourceRef || null,
        description: parsed.data.description || null,
        status: newStatus,
        completedAt,
        // A rule-generated deadline moved by hand keeps its new date
        // when its own anchor later moves (listed unticked).
        ...(dateChanged && deadline.deadlineRuleId ? { dueDateSetManually: true } : {}),
      },
    });
    if (write.count === 0) return false;
    if (dateChanged && decision === "apply") {
      recalculated = await applyRecalc(tx, deadline.matterId, trigger, selectedIds);
    }
    return true;
  });
  if (!saved) {
    revalidateDeadlineSurfaces(deadline.matterId);
    return { status: "error", errors: { _form: [STALE_MESSAGE] } };
  }

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
  if ((parsed.data.sourceRef || null) !== deadline.sourceRef) {
    changes.push(`source "${deadline.sourceRef ?? ""}" → "${parsed.data.sourceRef ?? ""}"`);
  }
  if ((parsed.data.description || null) !== deadline.description) {
    changes.push("description edited");
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
  for (const c of recalculated) {
    await logActivity({
      matterId: deadline.matterId,
      userId,
      type: "deadline",
      title: "Deadline recalculated",
      detail: `${describeRecalc(c)} — after "${parsed.data.title}" moved`,
    });
  }

  revalidateDeadlineSurfaces(deadline.matterId);
  return { status: "ok" };
}
