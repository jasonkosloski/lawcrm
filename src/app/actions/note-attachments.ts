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
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only inputs ("YYYY-MM-DD") are stored at UTC midnight and read
// in UTC (ADR-012) - parseDateOnly, never `new Date(value)`.
import { parseDateOnly } from "@/lib/format-date";
import { plural } from "@/lib/utils";
import {
  requirePermission,
  requirePermissions,
} from "@/lib/permission-check";
import { requiredCapturePermissions } from "@/lib/capture-permissions";
import { resolveAutoAddTeam } from "@/lib/calendar-default-attendees";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { logActivity } from "@/lib/activity-log";
import { isKnownUtbmsCode } from "@/lib/time-entry-constants";
import type {
  BulkAttachFormState,
  NoteAttachmentFormState,
} from "@/lib/note-attachment-form";
import {
  createCaptureRecord,
  missingPermissions,
  parseCaptures,
  permissionDeniedMessage,
} from "@/lib/note-captures";
import { CAPTURE_KIND_LABEL, type CaptureKind } from "@/lib/note-constants";

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
  await assertChildMatterAccess("note", noteId);
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
    ? parseDateOnly(parsed.data.dueDate)
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
  await assertChildMatterAccess("note", noteId);
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

  const dueDate = parseDateOnly(parsed.data.dueDate);
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
  await assertChildMatterAccess("note", noteId);
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

  const date = parseDateOnly(parsed.data.date);
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

/**
 * Bulk-attach the contents of a CaptureStack to a saved note in
 * one transaction. Shares its parse + create pipeline with
 * `createNote` (src/lib/note-captures.ts), scoped to an existing
 * note.
 *
 * Only task / deadline / time / event captures are created here.
 * `note_sibling` captures are dropped: replies belong to the reply
 * composer, and the bulk surfaces never offer the kind. A payload
 * that holds nothing creatable is rejected as "Nothing to save"
 * rather than reporting a phantom success.
 */
export async function addCapturesToNoteBulk(
  noteId: string,
  _prev: BulkAttachFormState,
  formData: FormData
): Promise<BulkAttachFormState> {
  await assertChildMatterAccess("note", noteId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const tz = await getCurrentUserTimeZone();
  const parsedCaptures = parseCaptures(parsed.data.attachments, tz);
  if (!parsedCaptures.ok) {
    if (parsedCaptures.reason === "malformed") {
      return {
        status: "error",
        errors: { attachments: ["Captures payload was malformed"] },
      };
    }
    return {
      status: "error",
      errors: {},
      attachmentErrors: parsedCaptures.attachmentErrors,
    };
  }

  // Creatable kinds only (see the docstring). Everything below -
  // gates, rows, activity tally - works from this filtered list.
  const prepared = parsedCaptures.captures.filter(
    (p) => p.cap.kind !== "note_sibling"
  );
  if (prepared.length === 0) {
    return { status: "error", errors: { attachments: ["Nothing to save"] } };
  }
  const validCaptures = prepared.map((p) => p.cap);

  // Gate on the union of capabilities the payload exercises (shared
  // with createNote / the primary composers). One denied kind rejects
  // the whole batch - it's a single transaction, so partially applying
  // the stack would be surprising. The friendly check returns a form
  // error (the stack keeps its contents); requirePermissions is the
  // enforcement point.
  const requiredKeys = requiredCapturePermissions(validCaptures);
  const missing = await missingPermissions(requiredKeys);
  if (missing.length > 0) {
    return {
      status: "error",
      errors: { attachments: [permissionDeniedMessage(missing)] },
    };
  }
  await requirePermissions(requiredKeys);

  const note = await resolveNoteMatter(noteId);
  if (!note) {
    return {
      status: "error",
      errors: { attachments: ["Note no longer exists"] },
    };
  }

  const userId = await getCurrentUserId();
  const autoAddTeam = await resolveAutoAddTeam(note.matterId, validCaptures);
  const createdEventIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const p of prepared) {
      await createCaptureRecord(tx, p, {
        matterId: note.matterId,
        userId,
        noteId,
        autoAddTeam,
        createdEventIds,
      });
    }
  });

  // Google Calendar push for the new events - after the commit.
  // Never rejects.
  for (const id of createdEventIds) await pushEventToGoogle(id);

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

  // Compose a "1 task · 2 deadlines · 2 time entries" summary for the
  // activity log.
  const tally = validCaptures.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(tally)
    .map(([k, n]) =>
      plural(n, (CAPTURE_KIND_LABEL[k as CaptureKind] ?? k).toLowerCase())
    )
    .join(" · ");
  await logActivity({
    matterId: note.matterId,
    userId,
    type: "note",
    title: `${plural(validCaptures.length, "item")} added to note`,
    detail: summary,
  });

  return { status: "ok" };
}
