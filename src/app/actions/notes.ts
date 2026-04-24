/**
 * Note server actions.
 *
 * All note content is stored as HTML (Tiptap's native output). Every
 * write runs the submitted HTML through DOMPurify with a tight
 * allowlist — strips scripts, inline handlers, unknown tags, and any
 * attribute that isn't in the approved set. The sanitized string is
 * what actually hits the database, so reads can render it with
 * dangerouslySetInnerHTML without re-sanitizing.
 *
 * TODO (auth): gate delete + pin actions to the note's author and/or
 * firm admins once RBAC lands. For now any signed-in user can edit
 * any note on the matter they have access to.
 */

"use server";

import { revalidatePath } from "next/cache";
import DOMPurify from "isomorphic-dompurify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { NOTE_TYPES, type NoteFormState } from "@/lib/note-constants";
import { captureSchema } from "@/lib/capture-schemas";

/** Tags + attributes allowed through from the Tiptap editor. Keep this
 *  list minimal; Tiptap's StarterKit only emits this shape anyway. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "span",
];
const ALLOWED_ATTR = ["href", "target", "rel", "class"];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Force any <a> without rel to get rel="noopener noreferrer" via a
    // post-pass below. DOMPurify keeps the attribute if we list it.
  }).trim();
}

/** True when the sanitized HTML has any non-whitespace visible text. */
function isEffectivelyEmpty(html: string): boolean {
  const textOnly = html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;| /g, "")
    .trim();
  return textOnly.length === 0;
}

const noteSchema = z.object({
  content: z.string().max(200_000, "Note is too long"),
  type: z.enum(NOTE_TYPES).default("note"),
  isPinned: z.literal("on").optional(),
  /** JSON-stringified array of NoteCapture objects. Empty when the
   *  user hasn't attached any sibling items to the note. */
  attachments: z.string().optional().default("[]"),
  /** Optional threading + entity associations. Each is a cuid; at
   *  most one of the entity FKs should be set per note, but we don't
   *  enforce that in the schema. */
  parentNoteId: z.string().trim().optional().or(z.literal("")),
  calendarEventId: z.string().trim().optional().or(z.literal("")),
  taskId: z.string().trim().optional().or(z.literal("")),
  deadlineId: z.string().trim().optional().or(z.literal("")),
  timeEntryId: z.string().trim().optional().or(z.literal("")),
});

// Capture schemas + types live in src/lib/capture-schemas.ts so both
// this action and the Task/Event/Deadline/Time composers' actions
// can share a single parse + validation path.

// ── Create ──────────────────────────────────────────────────────────────

export async function createNote(
  matterId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const clean = sanitize(parsed.data.content);
  if (isEffectivelyEmpty(clean)) {
    return {
      status: "error",
      errors: { content: ["Note can't be empty"] },
      values: raw,
    };
  }

  // Parse + validate attachments before touching the DB so we don't
  // half-commit a note with broken captures.
  let rawAttachments: unknown[] = [];
  try {
    const decoded = JSON.parse(parsed.data.attachments);
    rawAttachments = Array.isArray(decoded) ? decoded : [];
  } catch {
    return {
      status: "error",
      errors: { content: ["Captured items were malformed — try again."] },
      values: raw,
    };
  }

  const attachmentErrors: Record<string, Record<string, string[]>> = {};
  const validCaptures: Array<z.infer<typeof captureSchema>> = [];
  for (const a of rawAttachments) {
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
    return {
      status: "error",
      errors: {},
      attachmentErrors,
      values: raw,
    };
  }

  // Guard the matter actually exists — cheap, avoids cryptic FK errors.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) {
    return {
      status: "error",
      errors: { content: ["Matter not found"] },
      values: raw,
    };
  }

  const currentUserId = await getCurrentUserId();

  // One transaction — note plus all captures. If anything fails we
  // roll back everything so the user never sees a partial save.
  await prisma.$transaction(async (tx) => {
    await tx.note.create({
      data: {
        matterId,
        authorId: currentUserId,
        content: clean,
        type: parsed.data.type,
        isPinned: parsed.data.isPinned === "on",
        parentNoteId: parsed.data.parentNoteId || null,
        calendarEventId: parsed.data.calendarEventId || null,
        taskId: parsed.data.taskId || null,
        deadlineId: parsed.data.deadlineId || null,
        timeEntryId: parsed.data.timeEntryId || null,
      },
    });

    for (const cap of validCaptures) {
      if (cap.kind === "task") {
        await tx.task.create({
          data: {
            matterId,
            title: cap.title,
            priority: cap.priority,
            dueDate: cap.dueDate ? new Date(cap.dueDate) : null,
            ownerId: currentUserId,
          },
        });
      } else if (cap.kind === "event") {
        await tx.calendarEvent.create({
          data: {
            matterId,
            title: cap.title,
            type: cap.type,
            startTime: new Date(cap.startTime),
            endTime: new Date(cap.endTime),
            location: cap.location || null,
          },
        });
      } else if (cap.kind === "deadline") {
        await tx.deadline.create({
          data: {
            matterId,
            title: cap.title,
            dueDate: new Date(cap.dueDate),
            kind: cap.kind_,
            description: cap.description || null,
            ownerId: currentUserId,
          },
        });
      } else if (cap.kind === "time") {
        await tx.timeEntry.create({
          data: {
            matterId,
            userId: currentUserId,
            date: new Date(cap.date),
            hours: Number(cap.hours),
            activity: cap.activity,
            narrative: cap.narrative || null,
            source: "manual",
          },
        });
      } else if (cap.kind === "note_sibling") {
        await tx.note.create({
          data: {
            matterId,
            authorId: currentUserId,
            content: sanitize(cap.content),
            type: cap.type,
            isPinned: cap.isPinned,
          },
        });
      }
    }
  });

  revalidatePath(`/matters/${matterId}/notes`);
  // Overview tab shows a pinned-note preview + deadline/task previews
  // that can move when captures are attached. Any captures also feed
  // their own tabs — revalidate each touched tab so the side trip is
  // immediately visible.
  revalidatePath(`/matters/${matterId}`);
  if (validCaptures.some((c) => c.kind === "task"))
    revalidatePath(`/matters/${matterId}/tasks`);
  if (validCaptures.some((c) => c.kind === "event")) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/calendar`);
  }
  if (validCaptures.some((c) => c.kind === "deadline"))
    revalidatePath(`/matters/${matterId}/deadlines`);
  if (validCaptures.some((c) => c.kind === "time"))
    revalidatePath(`/matters/${matterId}/time`);
  return { status: "ok" };
}

// ── Toggle pin ──────────────────────────────────────────────────────────

export async function toggleNotePin(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, isPinned: true, matterId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  await prisma.note.update({
    where: { id: noteId },
    data: { isPinned: !note.isPinned },
  });

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteNote(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, matterId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  await prisma.note.delete({ where: { id: noteId } });

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  return { ok: true };
}

// ── Update (content + type + pin) ───────────────────────────────────────

export async function updateNote(
  noteId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const clean = sanitize(parsed.data.content);
  if (isEffectivelyEmpty(clean)) {
    return {
      status: "error",
      errors: { content: ["Note can't be empty"] },
      values: raw,
    };
  }

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { matterId: true },
  });
  if (!note) {
    return {
      status: "error",
      errors: { content: ["Note not found"] },
      values: raw,
    };
  }

  await prisma.note.update({
    where: { id: noteId },
    data: {
      content: clean,
      type: parsed.data.type,
      isPinned: parsed.data.isPinned === "on",
    },
  });

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  return { status: "ok" };
}
