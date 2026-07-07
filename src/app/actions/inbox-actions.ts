/**
 * Inbox actions — promote an email thread or messenger item into a
 * task / deadline / note.
 *
 * Six actions, two per source kind (email, messenger), three per
 * affordance (task, deadline, note). Each one:
 *   1. Resolves the matter the source belongs to (action fails if
 *      unfiled — UI gates against this too).
 *   2. Creates the new entity with the source FK set so the
 *      reverse-link chip ("From email" / "From message") can render.
 *   3. Sanitizes the note body if applicable (HTML through
 *      `sanitizeUserHtml`, same as createNote).
 *   4. Revalidates every surface that should reflect the new row.
 *
 * Source-content prefill happens client-side in the inbox action
 * dialog, so these actions just trust the form payload.
 *
 * Auth: promoting a source into an entity is the same capability as
 * creating that entity directly, so each action gates on the matching
 * create key (`tasks.create` / `deadlines.create` / `notes.create`) —
 * no separate "promote" permission.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { NOTE_TYPES } from "@/lib/note-constants";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import type { InboxActionFormState } from "@/lib/inbox-action-form";
import { logActivity } from "@/lib/activity-log";
import {
  isEffectivelyEmpty,
  sanitizeUserHtml as sanitize,
} from "@/lib/sanitize-html";

/** Resolve the matter for an email thread. Inbox actions require a
 *  filed source — unfiled threads can't spawn matter-scoped entities
 *  because there's no matter to attach them to. */
async function resolveEmailMatter(
  emailThreadId: string
): Promise<{ matterId: string } | null> {
  const t = await prisma.emailThread.findUnique({
    where: { id: emailThreadId },
    select: { matterId: true },
  });
  if (!t || !t.matterId) return null;
  return { matterId: t.matterId };
}

/** Resolve the matter for a messenger item. Falls back to the thread's
 *  defaultMatter when the item itself isn't filed — matches the
 *  read-time behavior in the messenger reader. */
async function resolveMessengerMatter(
  messengerItemId: string
): Promise<{ matterId: string } | null> {
  const item = await prisma.messengerItem.findUnique({
    where: { id: messengerItemId },
    select: {
      matterId: true,
      thread: { select: { defaultMatterId: true } },
    },
  });
  if (!item) return null;
  const matterId = item.matterId ?? item.thread?.defaultMatterId ?? null;
  if (!matterId) return null;
  return { matterId };
}

/** Path-revalidate every surface that displays the spawned entity. */
function revalidateForSpawn(
  matterId: string,
  kind: "task" | "deadline" | "note",
  source: "email" | "messenger"
): void {
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/communication");
  if (kind === "task") {
    revalidatePath(`/matters/${matterId}/tasks`);
    revalidatePath("/"); // dashboard "Your tasks"
  }
  if (kind === "deadline") {
    revalidatePath(`/matters/${matterId}/deadlines`);
    revalidatePath("/"); // dashboard "Deadlines this week"
  }
  if (kind === "note") {
    revalidatePath(`/matters/${matterId}/notes`);
  }
  if (source === "messenger") {
    // Messenger view + the matter Communication tab both render the
    // source thread — refresh both so the action is reflected.
    revalidatePath(`/matters/${matterId}/communication`);
  }
}

// ── Schemas ─────────────────────────────────────────────────────────────

// Due dates are date-only "YYYY-MM-DD" from <input type="date"> —
// parse to LOCAL midnight via parseLocalDate right in the schema.
// `new Date(value)` would read them as UTC midnight and drift the
// due date a day early for anyone west of UTC.

/** Optional date-only field → local-midnight Date or null. */
const optionalLocalDate = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((v, ctx) => {
    if (!v) return null;
    const d = parseLocalDate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

/** Required date-only field → local-midnight Date. */
const requiredLocalDate = z
  .string()
  .min(1, "Due date is required")
  .transform((v, ctx) => {
    const d = parseLocalDate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  dueDate: optionalLocalDate,
  priority: z.enum(TASK_PRIORITIES).default("normal"),
});

const deadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: requiredLocalDate,
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  description: z.string().max(4000).optional().or(z.literal("")),
});

const noteSchema = z.object({
  content: z.string().max(200_000),
  type: z.enum(NOTE_TYPES).default("note"),
});

// ── Email thread → ... ──────────────────────────────────────────────────

export async function createTaskFromEmail(
  emailThreadId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("tasks.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const ctx = await resolveEmailMatter(emailThreadId);
  if (!ctx) {
    return {
      status: "error",
      errors: { title: ["Email thread isn't filed to a matter — file it first."] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.task.create({
    data: {
      matterId: ctx.matterId,
      emailThreadId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate,
      ownerId: userId,
    },
  });
  revalidateForSpawn(ctx.matterId, "task", "email");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "task",
    title: "Task created from email",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

export async function createDeadlineFromEmail(
  emailThreadId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("deadlines.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = deadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const ctx = await resolveEmailMatter(emailThreadId);
  if (!ctx) {
    return {
      status: "error",
      errors: { title: ["Email thread isn't filed to a matter — file it first."] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.deadline.create({
    data: {
      matterId: ctx.matterId,
      emailThreadId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      kind: parsed.data.kind,
      description: parsed.data.description || null,
      ownerId: userId,
    },
  });
  revalidateForSpawn(ctx.matterId, "deadline", "email");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "deadline",
    title: "Deadline created from email",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

export async function createNoteFromEmail(
  emailThreadId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("notes.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const clean = sanitize(parsed.data.content);
  if (isEffectivelyEmpty(clean)) {
    return { status: "error", errors: { content: ["Note can't be empty"] } };
  }
  const ctx = await resolveEmailMatter(emailThreadId);
  if (!ctx) {
    return {
      status: "error",
      errors: { content: ["Email thread isn't filed to a matter — file it first."] },
    };
  }
  const userId = await getCurrentUserId();
  const created = await prisma.note.create({
    data: {
      matterId: ctx.matterId,
      authorId: userId,
      emailThreadId,
      content: clean,
      type: parsed.data.type,
    },
    select: { id: true },
  });
  // Author auto-reads their own note.
  await prisma.noteRead.create({
    data: { userId, noteId: created.id },
  });
  revalidateForSpawn(ctx.matterId, "note", "email");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "note",
    title: "Note saved from email",
    detail:
      clean
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Note",
  });
  return { status: "ok" };
}

// ── Messenger item → ... ────────────────────────────────────────────────

export async function createTaskFromMessage(
  messengerItemId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("tasks.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const ctx = await resolveMessengerMatter(messengerItemId);
  if (!ctx) {
    return {
      status: "error",
      errors: { title: ["This conversation isn't filed to a matter yet."] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.task.create({
    data: {
      matterId: ctx.matterId,
      messengerItemId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate,
      ownerId: userId,
    },
  });
  revalidateForSpawn(ctx.matterId, "task", "messenger");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "task",
    title: "Task created from message",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

export async function createDeadlineFromMessage(
  messengerItemId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("deadlines.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = deadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const ctx = await resolveMessengerMatter(messengerItemId);
  if (!ctx) {
    return {
      status: "error",
      errors: { title: ["This conversation isn't filed to a matter yet."] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.deadline.create({
    data: {
      matterId: ctx.matterId,
      messengerItemId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      kind: parsed.data.kind,
      description: parsed.data.description || null,
      ownerId: userId,
    },
  });
  revalidateForSpawn(ctx.matterId, "deadline", "messenger");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "deadline",
    title: "Deadline created from message",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

export async function createNoteFromMessage(
  messengerItemId: string,
  _prev: InboxActionFormState,
  formData: FormData
): Promise<InboxActionFormState> {
  await requirePermission("notes.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const clean = sanitize(parsed.data.content);
  if (isEffectivelyEmpty(clean)) {
    return { status: "error", errors: { content: ["Note can't be empty"] } };
  }
  const ctx = await resolveMessengerMatter(messengerItemId);
  if (!ctx) {
    return {
      status: "error",
      errors: { content: ["This conversation isn't filed to a matter yet."] },
    };
  }
  const userId = await getCurrentUserId();
  const created = await prisma.note.create({
    data: {
      matterId: ctx.matterId,
      authorId: userId,
      messengerItemId,
      content: clean,
      type: parsed.data.type,
    },
    select: { id: true },
  });
  await prisma.noteRead.create({
    data: { userId, noteId: created.id },
  });
  revalidateForSpawn(ctx.matterId, "note", "messenger");
  await logActivity({
    matterId: ctx.matterId,
    userId,
    type: "note",
    title: "Note saved from message",
    detail:
      clean
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Note",
  });
  return { status: "ok" };
}
