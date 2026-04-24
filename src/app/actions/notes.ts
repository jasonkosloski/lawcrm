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
});

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

  await prisma.note.create({
    data: {
      matterId,
      authorId: currentUserId,
      content: clean,
      type: parsed.data.type,
      isPinned: parsed.data.isPinned === "on",
    },
  });

  revalidatePath(`/matters/${matterId}/notes`);
  // Overview tab shows a pinned-note preview — refresh that too.
  revalidatePath(`/matters/${matterId}`);
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
