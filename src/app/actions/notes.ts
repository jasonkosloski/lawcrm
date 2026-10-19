/**
 * Note server actions.
 *
 * All note content is stored as HTML (Tiptap's native output). Every
 * write runs the submitted HTML through `sanitizeUserHtml` (see
 * src/lib/sanitize-html.ts) — strips scripts, inline handlers,
 * unknown tags, and any attribute that isn't in the approved set.
 * The sanitized string is what actually hits the database, so reads
 * can render it with dangerouslySetInnerHTML without re-sanitizing.
 *
 * Scope: a note belongs to EXACTLY ONE of a matter or a lead (see
 * src/lib/note-scope.ts). `createNote` writes matter notes,
 * `createLeadNote` intake notes; every other action works on either
 * scope and revalidates the matching surface.
 *
 * Auth:
 *   - createNote: `notes.create`, PLUS the create key of every
 *     capture kind it carries (tasks/events/deadlines/time_entries
 *     .create) and `notes.pin` when the note or a sibling note is
 *     pinned — all checked before any write
 *   - createLeadNote: `notes.create` (+ `notes.pin` when pinned). No
 *     captures — tasks, deadlines and events need a matter
 *   - toggleNotePin: `notes.pin` (no author bypass — pinning is a
 *     firm-wide signal, usually reserved for case leads)
 *   - deleteNote: author bypass + `notes.delete_any` for crossing
 *     ownership. The author bypass does NOT extend to a thread
 *     other people replied to: the delete cascades to replies, so
 *     removing a note with others' replies needs `notes.delete_any`
 *   - updateNote: author bypass + `notes.edit_any` for crossing
 *     ownership. Never touches isPinned — pinning stays behind
 *     toggleNotePin's `notes.pin` gate.
 *   - markMatterNotesRead / toggleNoteReaction: ungated. Recording
 *     reads + reacting are reader-side actions; anyone with note
 *     visibility can do them.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import {
  assertChildMatterAccess,
  assertMatterAccess,
  assertOptionalMatterAccess,
} from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import {
  currentUserHasPermission,
  requirePermission,
  requirePermissions,
} from "@/lib/permission-check";
import { requiredCapturePermissions } from "@/lib/capture-permissions";
import { resolveAutoAddTeam } from "@/lib/calendar-default-attendees";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import {
  NOTE_TYPES,
  REACTION_EMOJIS,
  type NoteFormState,
} from "@/lib/note-constants";
import {
  createCaptureRecord,
  missingPermissions,
  parseCaptures,
  permissionDeniedMessage,
} from "@/lib/note-captures";
import { noteToPlainText } from "@/lib/note-text";
import { logActivity } from "@/lib/activity-log";
import {
  notePathsToRevalidate,
  noteScopeOf,
  type NoteScope,
} from "@/lib/note-scope";
import type { LeadStage } from "@/lib/constants/lead-stage";
import {
  isEffectivelyEmpty,
  sanitizeUserHtml as sanitize,
} from "@/lib/sanitize-html";
import { assertLeadAccess } from "@/lib/lead-access";

const noteSchema = z.object({
  content: z.string().max(200_000, "Note is too long"),
  type: z.enum(NOTE_TYPES).default("note"),
  isPinned: z.literal("on").optional(),
  /** JSON-stringified array of NoteCapture objects. Empty when the
   *  user hasn't attached any sibling items to the note. */
  attachments: z.string().optional().default("[]"),
  /** Optional threading + entity associations. Each is a cuid; at
   *  most one of the entity FKs should be set per note, but we don't
   *  enforce that in the schema. createNote does verify each id
   *  exists AND belongs to the target matter before writing. */
  parentNoteId: z.string().trim().optional().or(z.literal("")),
  calendarEventId: z.string().trim().optional().or(z.literal("")),
  taskId: z.string().trim().optional().or(z.literal("")),
  deadlineId: z.string().trim().optional().or(z.literal("")),
  timeEntryId: z.string().trim().optional().or(z.literal("")),
});

// Capture schemas + types live in src/lib/capture-schemas.ts so both
// this action and the Task/Event/Deadline/Time composers' actions
// can share a single parse + validation path.

// Typed against the centralized LeadStage union (time-entries.ts
// pattern) so a typo can't let post-conversion intake notes through.
const CONVERTED = "converted" satisfies LeadStage;

function revalidateNoteScope(
  scope: NoteScope,
  opts: { calendarEventId?: string | null } = {}
): void {
  for (const path of notePathsToRevalidate(scope, opts)) revalidatePath(path);
}

/** Activity-log matterId for a note: lead notes have no matter, so
 *  their rows are firm-wide (like intake time). */
function activityMatterId(scope: NoteScope): string | null {
  return scope.kind === "matter" ? scope.matterId : null;
}

/** Short plain-text preview of note HTML for activity-log entries
 *  (entities decoded, so "Smith &amp; Jones" reads "Smith & Jones"). */
function notePreview(html: string): string {
  return noteToPlainText(html).slice(0, 80);
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createNote(
  matterId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  await requirePermission("notes.create");
  await assertMatterAccess(matterId);
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
  // half-commit a note with broken captures. Event times are typed as
  // wall-clock time in the viewer's profile zone.
  const tz = await getCurrentUserTimeZone();
  const parsedCaptures = parseCaptures(parsed.data.attachments, tz);
  if (!parsedCaptures.ok) {
    if (parsedCaptures.reason === "malformed") {
      return {
        status: "error",
        errors: { content: ["Captured items were malformed — try again."] },
        values: raw,
      };
    }
    return {
      status: "error",
      errors: {},
      attachmentErrors: parsedCaptures.attachmentErrors,
      values: raw,
    };
  }
  const prepared = parsedCaptures.captures;
  const validCaptures = prepared.map((p) => p.cap);

  // Every record kind the note carries must clear its own create
  // gate (and pinning needs notes.pin) BEFORE any write — notes.create
  // alone must not mint tasks / deadlines / events / billable time.
  // The friendly check comes first: a denied kind returns a form error
  // (the composer keeps what was typed); requirePermissions below is
  // the enforcement point and redirects for anything that slips past.
  const requiredKeys = requiredCapturePermissions(validCaptures, {
    pinRequested: parsed.data.isPinned === "on",
  });
  const missing = await missingPermissions(requiredKeys);
  if (missing.length > 0) {
    return {
      status: "error",
      errors: { content: [permissionDeniedMessage(missing)] },
      values: raw,
    };
  }
  await requirePermissions(requiredKeys);

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

  // Association FKs come straight from the client (hidden inputs on
  // the composer). Verify each provided id exists AND belongs to this
  // matter before writing — a stale or forged id would otherwise blow
  // up on the FK constraint inside the transaction (nonexistent id)
  // or silently link the note across matters (valid id from a
  // different matter). One Promise.all keeps the guard to a single
  // extra round trip.
  const assocLookups: Array<{
    label: string;
    query: Promise<{ matterId: string | null } | null>;
  }> = [];
  if (parsed.data.parentNoteId)
    assocLookups.push({
      label: "Parent note",
      query: prisma.note.findUnique({
        where: { id: parsed.data.parentNoteId },
        select: { matterId: true },
      }),
    });
  if (parsed.data.calendarEventId)
    assocLookups.push({
      label: "Linked event",
      query: prisma.calendarEvent.findUnique({
        where: { id: parsed.data.calendarEventId },
        select: { matterId: true },
      }),
    });
  if (parsed.data.taskId)
    assocLookups.push({
      label: "Linked task",
      query: prisma.task.findUnique({
        where: { id: parsed.data.taskId },
        select: { matterId: true },
      }),
    });
  if (parsed.data.deadlineId)
    assocLookups.push({
      label: "Linked deadline",
      query: prisma.deadline.findUnique({
        where: { id: parsed.data.deadlineId },
        select: { matterId: true },
      }),
    });
  if (parsed.data.timeEntryId)
    assocLookups.push({
      label: "Linked time entry",
      query: prisma.timeEntry.findUnique({
        where: { id: parsed.data.timeEntryId },
        select: { matterId: true },
      }),
    });
  if (assocLookups.length > 0) {
    const rows = await Promise.all(assocLookups.map((l) => l.query));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Strict same-matter check — a firm-wide task/event (null
      // matterId) is also rejected; matter notes only attach to
      // records of that matter.
      if (!row || row.matterId !== matterId) {
        return {
          status: "error",
          errors: {
            content: [`${assocLookups[i].label} not found on this matter`],
          },
          values: raw,
        };
      }
    }
  }

  const currentUserId = await getCurrentUserId();
  // Calendar defaults for any sibling event, resolved before the tx.
  const autoAddTeam = await resolveAutoAddTeam(matterId, validCaptures);
  const createdEventIds: string[] = [];

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

    for (const p of prepared) {
      await createCaptureRecord(tx, p, {
        matterId,
        userId: currentUserId,
        noteId: created.id,
        autoAddTeam,
        createdEventIds,
      });
    }
  });

  // Google Calendar push for sibling events — after the commit,
  // never inside the transaction. Never rejects.
  for (const id of createdEventIds) await pushEventToGoogle(id);

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
  const previewText = notePreview(clean) || "Note added";
  await logActivity({
    matterId,
    userId: currentUserId,
    type: "note",
    title: parsed.data.parentNoteId ? "Reply added" : "Note added",
    detail: previewText,
  });

  return { status: "ok" };
}

/** Intake note on a lead (/intake/[id]/notes). Same content / type /
 *  pin / reply fields as createNote, but no captures: tasks,
 *  deadlines and events need a matter. Refused once the lead has
 *  converted — its notes moved to the matter, so write there. */
export async function createLeadNote(
  leadId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  await requirePermission("notes.create");
  // Restricted intake: 404 unless the viewer may see this lead (ADR-049).
  await assertLeadAccess(leadId);
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

  // The composer never sends captures or entity links for a lead; a
  // request that does is refused rather than silently dropping them.
  const d = parsed.data;
  if (
    d.attachments !== "[]" ||
    d.calendarEventId ||
    d.taskId ||
    d.deadlineId ||
    d.timeEntryId
  ) {
    return {
      status: "error",
      errors: {
        content: [
          "Intake notes can't carry tasks, deadlines, events or time — add those once the lead is a matter.",
        ],
      },
      values: raw,
    };
  }

  const pinRequested = d.isPinned === "on";
  if (pinRequested && !(await currentUserHasPermission("notes.pin"))) {
    return {
      status: "error",
      errors: {
        content: ["You don't have permission to pin notes. Turn off Pin and try again."],
      },
      values: raw,
    };
  }
  if (pinRequested) await requirePermission("notes.pin");

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, stage: true },
  });
  if (!lead) {
    return {
      status: "error",
      errors: { content: ["Lead no longer exists"] },
      values: raw,
    };
  }
  if (lead.stage === CONVERTED) {
    return {
      status: "error",
      errors: {
        content: [
          "Lead is already converted — its notes moved to the matter. Write this note there.",
        ],
      },
      values: raw,
    };
  }

  // A reply must thread under a note on this same lead.
  if (d.parentNoteId) {
    const parent = await prisma.note.findUnique({
      where: { id: d.parentNoteId },
      select: { leadId: true },
    });
    if (!parent || parent.leadId !== leadId) {
      return {
        status: "error",
        errors: { content: ["Parent note not found on this lead"] },
        values: raw,
      };
    }
  }

  const currentUserId = await getCurrentUserId();
  await prisma.$transaction(async (tx) => {
    const created = await tx.note.create({
      data: {
        leadId,
        authorId: currentUserId,
        content: clean,
        type: d.type,
        isPinned: pinRequested,
        parentNoteId: d.parentNoteId || null,
      },
      select: { id: true },
    });
    await tx.noteRead.create({
      data: { userId: currentUserId, noteId: created.id },
    });
  });

  revalidateNoteScope({ kind: "lead", leadId });
  // Lead-scoped: no matter to hang the row on, and no matter team to
  // scope the feed to — so no note text in the detail (intake-time
  // pattern).
  await logActivity({
    matterId: null,
    userId: currentUserId,
    type: "note",
    title: d.parentNoteId ? "Intake reply added" : "Intake note added",
  });
  return { status: "ok" };
}

// ── Toggle pin ──────────────────────────────────────────────────────────

export async function toggleNotePin(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  const actorId = await requirePermission("notes.pin");
  await assertChildMatterAccess("note", noteId);
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      isPinned: true,
      matterId: true,
      leadId: true,
      calendarEventId: true,
      content: true,
    },
  });
  if (!note) return { ok: false, error: "Note not found" };
  const scope = noteScopeOf(note);

  await prisma.note.update({
    where: { id: noteId },
    data: { isPinned: !note.isPinned },
  });

  revalidateNoteScope(scope, note);
  await logActivity({
    matterId: activityMatterId(scope),
    userId: actorId,
    type: "note",
    title: note.isPinned ? "Note unpinned" : "Note pinned",
    // Lead notes stay out of the firm-wide feed's text (see createLeadNote).
    detail: scope.kind === "matter" ? notePreview(note.content) : null,
  });
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

/** Every descendant reply of `rootId` (any depth) with its author.
 *  Replies nest, and the schema cascades the whole sub-thread, so a
 *  one-level lookup would miss deeper replies by other people. */
async function collectReplies(
  tx: Tx,
  rootId: string
): Promise<Array<{ id: string; authorId: string | null }>> {
  const found: Array<{ id: string; authorId: string | null }> = [];
  let level = [rootId];
  while (level.length > 0) {
    const rows = await tx.note.findMany({
      where: { parentNoteId: { in: level } },
      select: { id: true, authorId: true },
    });
    found.push(...rows);
    level = rows.map((r) => r.id);
  }
  return found;
}

export async function deleteNote(
  noteId: string
): Promise<{ ok: boolean; error?: string }> {
  await assertChildMatterAccess("note", noteId);
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      authorId: true,
      matterId: true,
      leadId: true,
      calendarEventId: true,
      content: true,
    },
  });
  if (!note) return { ok: false, error: "Note not found" };
  const scope = noteScopeOf(note);

  // Author can always delete their own; otherwise gate.
  const actorId = await getCurrentUserId();
  if (note.authorId !== actorId) {
    await requirePermission("notes.delete_any");
  }
  const canDeleteAny = await currentUserHasPermission("notes.delete_any");

  // The delete cascades to every reply. The author bypass covers
  // the author's own words only: if anyone else replied (at any
  // depth) removing the thread destroys their content, so it takes
  // notes.delete_any. The reply walk and the delete share one
  // transaction so they run back to back, but at the default READ
  // COMMITTED isolation that only narrows the race: a reply that
  // lands between the walk and the delete is still removed by the
  // database cascade without having been counted. Accepted - the
  // window is milliseconds, and the thread was the caller's to remove.
  const outcome = await prisma.$transaction(async (tx) => {
    const replies = await collectReplies(tx, noteId);
    const othersReplies = replies.filter((r) => r.authorId !== actorId).length;
    if (othersReplies > 0 && !canDeleteAny) {
      return { blocked: true as const, othersReplies };
    }
    await tx.note.delete({ where: { id: noteId } });
    return { blocked: false as const, replyCount: replies.length };
  });
  if (outcome.blocked) {
    return {
      ok: false,
      error:
        "Other people have replied to this note, so deleting it would delete their replies too. Ask someone with permission to delete it.",
    };
  }

  revalidateNoteScope(scope, note);
  await logActivity({
    matterId: activityMatterId(scope),
    userId: actorId,
    type: "note",
    title: "Note deleted",
    detail:
      scope.kind === "lead"
        ? null
        : outcome.replyCount > 0
        ? `${notePreview(note.content)} (+ ${outcome.replyCount} ${outcome.replyCount === 1 ? "reply" : "replies"})`
        : notePreview(note.content),
  });
  return { ok: true };
}

// ── Update (content + type) ─────────────────────────────────────────────

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

  await assertChildMatterAccess("note", noteId);
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { authorId: true, matterId: true, leadId: true },
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
      // isPinned deliberately excluded — pinning is a firm-wide
      // signal gated by `notes.pin` (see toggleNotePin). Routing it
      // through here would both bypass that gate and silently reset
      // the pin whenever the edit form omits the checkbox.
    },
  });

  const scope = noteScopeOf(note);
  revalidateNoteScope(scope);
  await logActivity({
    matterId: activityMatterId(scope),
    userId: actorId,
    type: "note",
    title: "Note edited",
    detail: scope.kind === "matter" ? notePreview(clean) : null,
  });
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
    select: { id: true, matterId: true },
  });
  // Lead notes (null matterId) carry no matter-team restriction.
  for (const mid of new Set(existing.map((n) => n.matterId))) {
    await assertOptionalMatterAccess(mid);
  }
  const validIds = existing.map((n) => n.id);
  if (validIds.length === 0) return { ok: true };

  await prisma.noteRead.createMany({
    data: validIds.map((noteId) => ({ userId, noteId })),
    // Re-marking an already-read note is the common case — the client
    // fires on every page visit — so collisions on the composite PK
    // are expected. Postgres supports skipDuplicates, which keeps the
    // whole batch a single idempotent statement.
    skipDuplicates: true,
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

  await assertChildMatterAccess("note", noteId);
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, matterId: true, leadId: true, calendarEventId: true },
  });
  if (!note) return { ok: false, error: "Note not found" };

  const userId = await getCurrentUserId();
  const key = { userId, noteId, emoji };
  // Delete-then-create instead of read-then-write: two tabs (or a
  // double tap) racing the same toggle used to throw P2002 / P2025
  // out of the action and blank the Notes tab. deleteMany never
  // throws on a missing row, and createMany + skipDuplicates never
  // throws on an existing one.
  const removed = await prisma.noteReaction.deleteMany({ where: key });
  if (removed.count === 0) {
    await prisma.noteReaction.createMany({ data: [key], skipDuplicates: true });
  }

  revalidateNoteScope(noteScopeOf(note), note);
  return { ok: true };
}
