/**
 * Matter / lead Tasks tab readers.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noteToPlainText } from "@/lib/note-text";
import { getCurrentUserId } from "@/lib/current-user";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import {
  resolveTz,
  EVENT_REF_SELECT,
  scrubEventRef,
} from "./shared";
import {
  MatterListOptions,
} from "./deadlines";
import {
  truncate,
  prettyPhoneForLink,
  capitalizeKind,
} from "./notes";
import { daysUntilDateOnly } from "@/lib/format-date";

// ── Tasks ────────────────────────────────────────────────────────────────

/** Shared "where did this come from?" reference rendered as a chip
 *  on tasks, deadlines, and time entries. Powers cross-feature
 *  navigability — click a task that came from an email and land on
 *  that email; click one spawned from a note and land on the note.
 *
 *  At most one of the underlying FKs (noteId / emailThreadId /
 *  messengerItemId) is set per row; the query picks the first
 *  populated one in priority order (note > email > message). */
export type EntitySource =
  | { kind: "note"; id: string; label: string }
  | { kind: "email"; id: string; label: string }
  | { kind: "message"; id: string; label: string }
  | { kind: "event"; id: string; label: string }
  | { kind: "deadline"; id: string; label: string }
  | { kind: "task"; id: string; label: string };

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: Date | null;
  daysUntilDue: number | null;
  /** Owner id (null = unassigned) — seeds the edit dialog's
   *  assignee picker. Name/initials below drive the row badge. */
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  createdAt: Date;
  /** Where the row was spawned from — note / email thread / messenger
   *  item. Null when the row was created directly. Drives the "From X"
   *  chip on the row. */
  spawnedFrom: EntitySource | null;
  /** Notes attached *to* this row (Note.taskId / .deadlineId / .timeEntryId
   *  pointing here). Powers the inline expandable panel below each
   *  row — symmetric to how the events tab shows notes attached to an
   *  event. Empty array when none. */
  attachedNotes: AttachedNotePreview[];
};

/** Compact note view for the row-attached-notes inline panel. Just
 *  enough to render a small card without re-fetching. */
export type AttachedNotePreview = {
  id: string;
  content: string;
  type: string;
  authorName: string;
  authorInitials: string;
  createdAt: Date;
};

export async function getMatterTasks(
  matterId: string,
  options: MatterListOptions = {}
): Promise<TaskRow[]> {
  return getTaskRows({ matterId }, options);
}

/** Intake tasks on a lead (/intake/[id]/tasks) — same row shape as
 *  matter tasks. Lead tasks have no spawn source or attached notes,
 *  so those come back empty. */
export async function getLeadTasks(
  leadId: string,
  options: MatterListOptions = {}
): Promise<TaskRow[]> {
  return getTaskRows({ leadId }, options);
}

async function getTaskRows(
  scopeWhere: Prisma.TaskWhereInput,
  options: MatterListOptions
): Promise<TaskRow[]> {
  const [viewerId, tz] = await Promise.all([
    getCurrentUserId(),
    resolveTz(options.tz),
  ]);
  const rows = await prisma.task.findMany({
    where: {
      ...scopeWhere,
      ...(options.openOnly
        ? { status: { in: ["open", "in_progress"] } }
        : {}),
    },
    take: options.limit,
    include: {
      owner: { select: { name: true, initials: true } },
      // Spawn-source includes — at most one of these is populated per
      // row. Fetched together so the chip render is a single query.
      parentNote: { select: { id: true, content: true } },
      emailThread: { select: { id: true, subject: true } },
      messengerItem: {
        select: {
          id: true,
          kind: true,
          thread: {
            select: {
              id: true,
              contactPhone: true,
              contact: { select: { name: true } },
            },
          },
        },
      },
      parentEvent: { select: EVENT_REF_SELECT },
      parentDeadline: { select: { id: true, title: true } },
      // Notes attached to this task (Note.taskId === task.id) —
      // surfaces in the row's inline expandable panel. Sorted oldest-
      // first so the conversation reads top-down.
      notes: {
        select: {
          id: true,
          content: true,
          type: true,
          createdAt: true,
          author: { select: { name: true, initials: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    // Date-only due date: calendar-day distance in the viewer's zone.
    daysUntilDue: t.dueDate ? daysUntilDateOnly(t.dueDate, tz) : null,
    ownerId: t.ownerId,
    ownerName: t.owner?.name ?? null,
    ownerInitials: t.owner?.initials ?? null,
    createdAt: t.createdAt,
    spawnedFrom: resolveEntitySource({
      note: t.parentNote,
      email: t.emailThread,
      messenger: t.messengerItem,
      event: scrubEventRef(t.parentEvent, viewerId),
      deadline: t.parentDeadline,
    }),
    attachedNotes: t.notes.map((n) => ({
      id: n.id,
      content: sanitizeUserHtml(n.content),
      type: n.type,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
    })),
  }));
}

/** Pick the first populated source FK in priority order and turn it
 *  into the typed EntitySource shape the UI expects. Note > email >
 *  message > event > deadline; only one chip ever renders per row so
 *  the most-specific source wins. */
export function resolveEntitySource(refs: {
  note: { id: string; content: string } | null;
  email: { id: string; subject: string } | null;
  messenger: {
    id: string;
    kind: string;
    thread: {
      id: string;
      contactPhone: string;
      contact: { name: string } | null;
    } | null;
  } | null;
  event?: { id: string; title: string } | null;
  deadline?: { id: string; title: string } | null;
  task?: { id: string; title: string } | null;
}): EntitySource | null {
  if (refs.note) {
    return {
      kind: "note",
      id: refs.note.id,
      label: truncate(noteToPlainText(refs.note.content), 60) || "note",
    };
  }
  if (refs.email) {
    return { kind: "email", id: refs.email.id, label: refs.email.subject };
  }
  if (refs.messenger) {
    const t = refs.messenger.thread;
    const who = t?.contact?.name ?? prettyPhoneForLink(t?.contactPhone ?? "");
    return {
      kind: "message",
      id: t?.id ?? refs.messenger.id,
      label: `${capitalizeKind(refs.messenger.kind)} from ${who}`,
    };
  }
  if (refs.event) {
    return { kind: "event", id: refs.event.id, label: refs.event.title };
  }
  if (refs.deadline) {
    return {
      kind: "deadline",
      id: refs.deadline.id,
      label: refs.deadline.title,
    };
  }
  if (refs.task) {
    return { kind: "task", id: refs.task.id, label: refs.task.title };
  }
  return null;
}
