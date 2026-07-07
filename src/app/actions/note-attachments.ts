/**
 * Note attachment actions — add a task / deadline / time entry to an
 * already-saved note.
 *
 * Each action mirrors the per-entity create logic but sets `noteId`
 * on the new row so it surfaces in the note's attached list. Same
 * Zod shapes the original capture composers use, so error rendering
 * lines up.
 *
 * Lives in its own file (not notes.ts) because it spans multiple
 * Prisma models — keeping notes.ts focused on Note CRUD makes the
 * intent obvious.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only inputs ("YYYY-MM-DD") must parse to LOCAL midnight —
// `new Date(value)` reads them as UTC midnight, drifting the day
// for anyone west of UTC. See parseLocalDate docs.
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { logActivity } from "@/lib/activity-log";
import { isKnownUtbmsCode } from "@/lib/time-entry-constants";
import type {
  BulkAttachFormState,
  NoteAttachmentFormState,
} from "@/lib/note-attachment-form";
import { captureSchema, type ValidCapture } from "@/lib/capture-schemas";

/** Resolve the matter the note belongs to. Used by every attach
 *  action since attached children inherit the note's matter. Throws
 *  through to the form-state error path so the UI can recover. */
async function resolveNoteMatter(noteId: string): Promise<{
  matterId: string;
} | null> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { matterId: true },
  });
  if (!note) return null;
  return { matterId: note.matterId };
}

/** Path-revalidate every surface that displays attachments of a
 *  given note. Notes tab is the obvious one; matter overview previews
 *  open tasks/deadlines so refresh those too. */
function revalidateForNote(matterId: string, kind: "task" | "deadline" | "time"): void {
  revalidatePath(`/matters/${matterId}/notes`);
  revalidatePath(`/matters/${matterId}`);
  if (kind === "task") {
    revalidatePath(`/matters/${matterId}/tasks`);
    revalidatePath("/"); // dashboard "Your tasks"
  }
  if (kind === "deadline") {
    revalidatePath(`/matters/${matterId}/deadlines`);
    revalidatePath("/"); // dashboard "Deadlines this week"
  }
  if (kind === "time") {
    revalidatePath(`/matters/${matterId}/time`);
  }
}

// Form state lives in `@/lib/note-attachment-form` since "use server"
// files can only export async functions — no consts, no types with a
// runtime shape. The three composer forms import from there.

// ── Task ────────────────────────────────────────────────────────────────

const addTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  dueDate: z.string().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
});

export async function addTaskToNote(
  noteId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  // Same gate as the standalone task composer — attaching to a note
  // still creates a Task row, so the same capability applies.
  await requirePermission("tasks.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = addTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const note = await resolveNoteMatter(noteId);
  if (!note) {
    return {
      status: "error",
      errors: { title: ["Note no longer exists"] },
    };
  }

  const dueDate = parsed.data.dueDate
    ? parseLocalDate(parsed.data.dueDate)
    : null;
  if (parsed.data.dueDate && !dueDate) {
    return { status: "error", errors: { dueDate: ["Invalid due date"] } };
  }

  const userId = await getCurrentUserId();
  await prisma.task.create({
    data: {
      matterId: note.matterId,
      noteId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      dueDate,
      ownerId: userId,
    },
  });

  revalidateForNote(note.matterId, "task");
  await logActivity({
    matterId: note.matterId,
    userId,
    type: "task",
    title: "Task added to note",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

// ── Deadline ────────────────────────────────────────────────────────────

const addDeadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string().min(1, "Due date is required"),
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  description: z.string().max(4000).optional().or(z.literal("")),
});

export async function addDeadlineToNote(
  noteId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("deadlines.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = addDeadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const note = await resolveNoteMatter(noteId);
  if (!note) {
    return {
      status: "error",
      errors: { title: ["Note no longer exists"] },
    };
  }

  const dueDate = parseLocalDate(parsed.data.dueDate);
  if (!dueDate) {
    return { status: "error", errors: { dueDate: ["Invalid due date"] } };
  }

  const userId = await getCurrentUserId();
  await prisma.deadline.create({
    data: {
      matterId: note.matterId,
      noteId,
      title: parsed.data.title,
      dueDate,
      kind: parsed.data.kind,
      description: parsed.data.description || null,
      ownerId: userId,
    },
  });

  revalidateForNote(note.matterId, "deadline");
  await logActivity({
    matterId: note.matterId,
    userId,
    type: "deadline",
    title: "Deadline added to note",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

// ── Time entry ──────────────────────────────────────────────────────────

const addTimeEntrySchema = z.object({
  date: z.string().min(1, "Date is required"),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  // Catalog-validated so junk can't reach the column that later
  // feeds LEDES/insurer exports. Empty = "no code".
  utbmsCode: z
    .string()
    .trim()
    .refine((v) => v === "" || isKnownUtbmsCode(v), "Unknown UTBMS code")
    .optional(),
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
});

export async function addTimeEntryToNote(
  noteId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = addTimeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const note = await resolveNoteMatter(noteId);
  if (!note) {
    return {
      status: "error",
      errors: { activity: ["Note no longer exists"] },
    };
  }

  const date = parseLocalDate(parsed.data.date);
  if (!date) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  const userId = await getCurrentUserId();
  await prisma.timeEntry.create({
    data: {
      matterId: note.matterId,
      userId,
      noteId,
      date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      utbmsCode: parsed.data.utbmsCode || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      source: "manual",
    },
  });

  revalidateForNote(note.matterId, "time");
  await logActivity({
    matterId: note.matterId,
    userId,
    type: "time_entry",
    title: `Time logged on note · ${parsed.data.hours}h`,
    detail: parsed.data.activity,
  });
  return { status: "ok" };
}

// ── Bulk add (CaptureStack from a saved note) ───────────────────────────

const bulkSchema = z.object({
  /** JSON-stringified array of NoteCapture items from CaptureStack. */
  attachments: z.string().min(2, "Nothing to save"),
});

/** Permission key each capture kind's standalone create path gates
 *  on (see `captures.ts`) — the bulk-attach surface must enforce the
 *  same capabilities or it becomes a bypass. `note_sibling` has no
 *  entry because the bulk loop deliberately ignores it. */
const CAPTURE_CREATE_PERMISSION: Partial<Record<ValidCapture["kind"], string>> = {
  task: "tasks.create",
  deadline: "deadlines.create",
  time: "time_entries.create",
  event: "events.create",
};

/**
 * Bulk-attach the contents of a CaptureStack to a saved note in
 * one transaction. Mirrors the capture-loop in `createNote` but
 * scoped to an existing note.
 *
 * `note_sibling` captures from the stack create independent matter
 * notes (without parentNoteId) — same semantics as the top-level
 * NoteComposer's CaptureStack. If a user wants threaded replies
 * they should use the reply composer instead.
 */
export async function addCapturesToNoteBulk(
  noteId: string,
  _prev: BulkAttachFormState,
  formData: FormData
): Promise<BulkAttachFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  let rawArr: unknown[] = [];
  try {
    const decoded = JSON.parse(parsed.data.attachments);
    rawArr = Array.isArray(decoded) ? decoded : [];
  } catch {
    return {
      status: "error",
      errors: { attachments: ["Captures payload was malformed"] },
    };
  }
  if (rawArr.length === 0) {
    return { status: "error", errors: { attachments: ["Nothing to save"] } };
  }

  const attachmentErrors: Record<string, Record<string, string[]>> = {};
  const validCaptures: ValidCapture[] = [];
  for (const a of rawArr) {
    const result = captureSchema.safeParse(a);
    if (!result.success) {
      const tempId =
        (a as { tempId?: unknown })?.tempId &&
        typeof (a as { tempId: unknown }).tempId === "string"
          ? ((a as { tempId: string }).tempId as string)
          : "unknown";
      attachmentErrors[tempId] = result.error.flatten().fieldErrors;
      continue;
    }
    validCaptures.push(result.data);
  }
  if (Object.keys(attachmentErrors).length > 0) {
    return { status: "error", errors: {}, attachmentErrors };
  }

  // Gate on the union of capabilities the payload exercises. One
  // denied kind rejects the whole batch — it's a single transaction,
  // so partially applying the stack would be surprising.
  const requiredPermissions = new Set<string>();
  for (const cap of validCaptures) {
    const key = CAPTURE_CREATE_PERMISSION[cap.kind];
    if (key) requiredPermissions.add(key);
  }
  for (const key of requiredPermissions) {
    await requirePermission(key);
  }

  const note = await resolveNoteMatter(noteId);
  if (!note) {
    return {
      status: "error",
      errors: { attachments: ["Note no longer exists"] },
    };
  }

  const userId = await getCurrentUserId();
  await prisma.$transaction(async (tx) => {
    for (const cap of validCaptures) {
      if (cap.kind === "task") {
        await tx.task.create({
          data: {
            matterId: note.matterId,
            noteId,
            title: cap.title,
            priority: cap.priority,
            // Capture dates are schema-validated as YYYY-MM-DD
            // (capture-schemas.ts), so parseLocalDate can't miss.
            dueDate: cap.dueDate ? parseLocalDate(cap.dueDate) : null,
            ownerId: userId,
          },
        });
      } else if (cap.kind === "deadline") {
        await tx.deadline.create({
          data: {
            matterId: note.matterId,
            noteId,
            title: cap.title,
            dueDate: parseLocalDate(cap.dueDate)!,
            kind: cap.kind_,
            description: cap.description || null,
            ownerId: userId,
          },
        });
      } else if (cap.kind === "time") {
        await tx.timeEntry.create({
          data: {
            matterId: note.matterId,
            userId,
            noteId,
            date: parseLocalDate(cap.date)!,
            hours: Number(cap.hours),
            activity: cap.activity,
            narrative: cap.narrative || null,
            source: "manual",
          },
        });
      } else if (cap.kind === "event") {
        // Events have their own primary surface; the link from
        // note-via-eventId is a thinner association. Don't set
        // noteId — Note.calendarEventId is the existing channel.
        await tx.calendarEvent.create({
          data: {
            matterId: note.matterId,
            title: cap.title,
            type: cap.type,
            startTime: new Date(cap.startTime),
            endTime: new Date(cap.endTime),
            location: cap.location || null,
          },
        });
      }
      // `note_sibling` deliberately ignored — replies belong to
      // the reply composer, not the bulk-attach surface.
    }
  });

  // Revalidate every kind that was touched.
  const kinds = new Set(validCaptures.map((c) => c.kind));
  if (kinds.has("task")) {
    revalidateForNote(note.matterId, "task");
  }
  if (kinds.has("deadline")) {
    revalidateForNote(note.matterId, "deadline");
  }
  if (kinds.has("time")) {
    revalidateForNote(note.matterId, "time");
  }
  if (kinds.has("event")) {
    revalidatePath(`/matters/${note.matterId}/events`);
    revalidatePath("/calendar");
    revalidatePath(`/matters/${note.matterId}/notes`);
  }

  // Compose a "1 task · 2 deadlines" summary for the activity log.
  const tally = validCaptures.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(tally)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
    .join(" · ");
  await logActivity({
    matterId: note.matterId,
    userId,
    type: "note",
    title: `${validCaptures.length} ${validCaptures.length === 1 ? "item" : "items"} added to note`,
    detail: summary,
  });

  return { status: "ok" };
}

