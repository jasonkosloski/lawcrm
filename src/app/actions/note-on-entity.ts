/**
 * "Add a note on this <task|deadline>" server actions.
 *
 * Mirror of `time-on-entity.ts` for notes — creates a Note row whose
 * `taskId` (or `deadlineId`) FK points at the parent so the note
 * surfaces in the parent's `attachedNotes` panel and renders a
 * "From task" / "From deadline" link chip.
 *
 * Plain-text body: the inline composer on these surfaces is a single
 * textarea, not the full Tiptap editor used on the matter Notes tab.
 * We escape user input and convert newlines to `<br>` so the persisted
 * HTML matches what every other note renderer expects.
 *
 * Auth: both actions gate on `notes.create`, the same key as the
 * primary composer in notes.ts — these are alternate doors into note
 * authorship, not a separate capability.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { NOTE_TYPES } from "@/lib/note-constants";
import type { NoteAttachmentFormState } from "@/lib/note-attachment-form";

/** Escape THEN insert <br> — order matters; doing <br> first would
 *  get the angle brackets escaped away. Keeps the persisted HTML in
 *  the same shape every other note writer produces. */
function textareaToHtml(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r?\n/g, "<br>");
}

const noteSchema = z.object({
  content: z.string().trim().min(1, "Note can't be empty").max(20_000),
  type: z.enum(NOTE_TYPES).default("note"),
});

// ── Task ────────────────────────────────────────────────────────────────

export async function addNoteToTask(
  taskId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  // Same key as the primary note composer (notes.ts createNote) — the
  // inline task composer is just another door into note authorship.
  await requirePermission("notes.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, title: true },
  });
  if (!task || !task.matterId) {
    return {
      status: "error",
      errors: { content: ["Task no longer exists or isn't on a matter"] },
    };
  }
  const userId = await getCurrentUserId();
  // Hoist past the null-check so the narrowed type survives into the
  // transaction closure below.
  const matterId = task.matterId;
  // Note + author's read marker in one transaction — the author always
  // starts "read" on their own note (matches every other note writer),
  // and a partial failure shouldn't leave the marker missing.
  await prisma.$transaction(async (tx) => {
    const created = await tx.note.create({
      data: {
        matterId,
        authorId: userId,
        taskId,
        content: textareaToHtml(parsed.data.content),
        type: parsed.data.type,
      },
      select: { id: true },
    });
    await tx.noteRead.create({
      data: { userId, noteId: created.id },
    });
  });

  revalidatePath(`/matters/${task.matterId}/tasks`);
  revalidatePath(`/matters/${task.matterId}/notes`);
  revalidatePath(`/matters/${task.matterId}`);
  // Dashboard "Your tasks" surfaces an attached-notes count, so bust
  // its cache too.
  revalidatePath("/");
  await logActivity({
    matterId: task.matterId,
    userId,
    type: "note",
    title: "Note added to task",
    detail: task.title,
  });
  return { status: "ok" };
}

// ── Deadline ────────────────────────────────────────────────────────────

export async function addNoteToDeadline(
  deadlineId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  // Same key as the primary note composer (notes.ts createNote) — the
  // inline deadline composer is just another door into note authorship.
  await requirePermission("notes.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true, title: true },
  });
  if (!deadline) {
    return {
      status: "error",
      errors: { content: ["Deadline no longer exists"] },
    };
  }
  const userId = await getCurrentUserId();
  // See addNoteToTask — note + author's read marker, atomically.
  await prisma.$transaction(async (tx) => {
    const created = await tx.note.create({
      data: {
        matterId: deadline.matterId,
        authorId: userId,
        deadlineId,
        content: textareaToHtml(parsed.data.content),
        type: parsed.data.type,
      },
      select: { id: true },
    });
    await tx.noteRead.create({
      data: { userId, noteId: created.id },
    });
  });

  revalidatePath(`/matters/${deadline.matterId}/deadlines`);
  revalidatePath(`/matters/${deadline.matterId}/notes`);
  revalidatePath(`/matters/${deadline.matterId}`);
  revalidatePath("/");
  await logActivity({
    matterId: deadline.matterId,
    userId,
    type: "note",
    title: "Note added to deadline",
    detail: deadline.title,
  });
  return { status: "ok" };
}
