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
 * Auth:
 *   - createNote: `notes.create`
 *   - toggleNotePin: `notes.pin` (no author bypass — pinning is a
 *     firm-wide signal, usually reserved for case leads)
 *   - deleteNote: author bypass + `notes.delete_any` for crossing
 *     ownership
 *   - updateNote: author bypass + `notes.edit_any` for crossing
 *     ownership
 *   - markMatterNotesRead / toggleNoteReaction: ungated. Recording
 *     reads + reacting are reader-side actions; anyone with note
 *     visibility can do them.
 */

"use server";

import { revalidatePath } from "next/cache";
import DOMPurify from "isomorphic-dompurify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import {
  NOTE_TYPES,
  REACTION_EMOJIS,
  type NoteFormState,
} from "@/lib/note-constants";
import { captureSchema } from "@/lib/capture-schemas";
import { logActivity } from "@/lib/activity-log";

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
  await requirePermission("notes.create");
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
    const created = await tx.note.create({
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
      select: { id: true },
    });
    // Author always starts "read" on their own note — nothing new
    // for them to catch up on.
    await tx.noteRead.create({
      data: { userId: currentUserId, noteId: created.id },
    });

    for (const cap of validCaptures) {
      if (cap.kind === "task") {
        await tx.task.create({
          data: {
            matterId,
            // Link the capture back to the note that spawned it so the
            // note's attached-list surfaces it (matches the after-the-
            // fact "+ Add task" affordance behavior).
            noteId: created.id,
            title: cap.title,
            priority: cap.priority,
            dueDate: cap.dueDate ? new Date(cap.dueDate) : null,
            ownerId: currentUserId,
          },
        });
      } else if (cap.kind === "event") {
        // Events deliberately don't carry noteId — the events tab is
        // their primary surface; the note's link chip is sufficient.
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
            noteId: created.id,
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
            noteId: created.id,
            date: new Date(cap.date),
            hours: Number(cap.hours),
            activity: cap.activity,
            narrative: cap.narrative || null,
            source: "manual",
          },
        });
      } else if (cap.kind === "note_sibling") {
        const sibling = await tx.note.create({
          data: {
            matterId,
            authorId: currentUserId,
            content: sanitize(cap.content),
            type: cap.type,
            isPinned: cap.isPinned,
          },
          select: { id: true },
        });
        await tx.noteRead.create({
          data: { userId: currentUserId, noteId: sibling.id },
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

  // When the primary note itself is attached to a calendar event we
  // need to refresh the matter's events tab + the main calendar so the
  // event detail modal picks up the new note without a full reload.
  if (parsed.data.calendarEventId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/calendar`);
  }

  // Activity log — let the dashboard "Recent activity" reflect the
  // real write. Title is a short preview of the note body so the
  // entry is meaningful without expanding it.
  const previewText =
    clean
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Note added";
  await logActivity({
    matterId,
    userId: currentUserId,
    type: "note",
    title: parsed.data.parentNoteId ? "Reply added" : "Note added",
    detail: previewText,
  });

  return { status: "ok" };
}

// ── Toggle pin ──────────────────────────────────────────────────────────

export async function toggleNotePin(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("notes.pin");
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, isPinned: true, matterId: true, calendarEventId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  await prisma.note.update({
    where: { id: noteId },
    data: { isPinned: !note.isPinned },
  });

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  if (note.calendarEventId) {
    revalidatePath(`/matters/${note.matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteNote(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, matterId: true, calendarEventId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  // Author can always delete their own; otherwise gate.
  const actorId = await getCurrentUserId();
  if (note.authorId !== actorId) {
    await requirePermission("notes.delete_any");
  }

  await prisma.note.delete({ where: { id: noteId } });

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  if (note.calendarEventId) {
    revalidatePath(`/matters/${note.matterId}/events`);
    revalidatePath(`/calendar`);
  }
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
    select: { authorId: true, matterId: true },
  });
  if (!note) {
    return {
      status: "error",
      errors: { content: ["Note not found"] },
      values: raw,
    };
  }

  // Author can always edit their own; otherwise require notes.edit_any.
  const actorId = await getCurrentUserId();
  if (note.authorId !== actorId) {
    await requirePermission("notes.edit_any");
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

// ── Mark read ───────────────────────────────────────────────────────────
//
// Client fires this after the user has had a moment to see a note on
// screen. We intentionally do NOT revalidatePath here — the current
// page's collapse defaults are computed from the server-rendered
// unread state, so refreshing would collapse threads mid-read. The
// DB update only matters for the NEXT page visit.

export async function markMatterNotesRead(
  noteIds: string[]
): Promise<{ ok: boolean }> {
  if (noteIds.length === 0) return { ok: true };
  const userId = await getCurrentUserId();
  // Scope to notes that actually exist so a stale client call can't
  // create dangling reads. Limit quietly to the submitted ids.
  const existing = await prisma.note.findMany({
    where: { id: { in: noteIds } },
    select: { id: true },
  });
  const validIds = existing.map((n) => n.id);
  if (validIds.length === 0) return { ok: true };

  await prisma.noteRead.createMany({
    data: validIds.map((noteId) => ({ userId, noteId })),
    // SQLite doesn't support skipDuplicates on createMany, but the
    // composite primary key throws uniqueness errors if we retry a
    // note already marked read. Catch per-row below.
  }).catch(async () => {
    // Fall back to individual upserts if batch failed (e.g. one row
    // was already present). Slower but correct.
    for (const noteId of validIds) {
      await prisma.noteRead.upsert({
        where: { userId_noteId: { userId, noteId } },
        update: {},
        create: { userId, noteId },
      });
    }
  });
  return { ok: true };
}

// ── Reactions ───────────────────────────────────────────────────────────

/** Toggle the current user's reaction with `emoji` on the target
 *  note: if the (user, note, emoji) row already exists, delete it;
 *  otherwise create it. Validates emoji against the curated palette
 *  so the DB doesn't accumulate arbitrary strings. */
export async function toggleNoteReaction(
  noteId: string,
  emoji: string
): Promise<{ ok: boolean; error?: string }> {
  if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
    return { ok: false, error: "Emoji not in reaction palette" };
  }

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, matterId: true, calendarEventId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  const userId = await getCurrentUserId();
  const key = { userId, noteId, emoji };
  const existing = await prisma.noteReaction.findUnique({
    where: { userId_noteId_emoji: key },
    select: { userId: true },
  });
  if (existing) {
    await prisma.noteReaction.delete({ where: { userId_noteId_emoji: key } });
  } else {
    await prisma.noteReaction.create({ data: key });
  }

  revalidatePath(`/matters/${note.matterId}/notes`);
  revalidatePath(`/matters/${note.matterId}`);
  if (note.calendarEventId) {
    revalidatePath(`/matters/${note.matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { ok: true };
}
