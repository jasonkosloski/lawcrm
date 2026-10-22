/**
 * Matter / lead Notes tab readers.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { REACTION_EMOJIS } from "@/lib/note-constants";
import { noteToPlainText } from "@/lib/note-text";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { formatPhone } from "@/lib/format-phone";
import { EVENT_REF_SELECT, eventLabelForViewer } from "./shared";

// ── Notes ────────────────────────────────────────────────────────────────

/** Compact reference to whatever entity a note is directly attached
 *  to — surfaced on the card so the user can see at a glance that
 *  this is e.g. a court note for a specific hearing. */
export type NoteLink =
  | { kind: "event"; id: string; label: string; startTime: Date }
  | { kind: "task"; id: string; label: string }
  | { kind: "deadline"; id: string; label: string; dueDate: Date }
  | { kind: "time"; id: string; label: string; date: Date }
  | { kind: "parent"; id: string; label: string }
  | { kind: "email"; id: string; label: string }
  | { kind: "message"; id: string; label: string };

/** Aggregated reaction for a single emoji on a note. */
export type NoteReactionSummary = {
  emoji: string;
  count: number;
  /** True when the current user is among the reactors — used to
   *  highlight the pill + toggle on click. */
  userReacted: boolean;
};

/** Compact view of a task attached to a note — drives the chip row. */
export type NoteAttachedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
};

/** Compact view of a deadline attached to a note. */
export type NoteAttachedDeadline = {
  id: string;
  title: string;
  status: string;
  kind: string;
  dueDate: Date;
};

/** Time entry attached to a note — same fields the events tab uses
 *  so the renderer can be shared. */
export type NoteAttachedTimeEntry = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  status: string;
  /** Who logged it - the UI offers Delete to the author or a
   *  time_entries.delete_any holder. */
  userId: string;
  userName: string;
  userInitials: string;
};

export type NoteRow = {
  id: string;
  type: string;
  content: string;
  isPinned: boolean;
  /** Author's user id - the UI offers Delete to the author or a
   *  notes.delete_any holder. */
  authorId: string;
  authorName: string;
  authorInitials: string;
  createdAt: Date;
  updatedAt: Date;
  parentNoteId: string | null;
  /** Single source-of-truth link shown on the card. Parent takes
   *  priority (a reply shows its parent context) — otherwise the
   *  first non-null entity FK wins. */
  link: NoteLink | null;
  /** Whether the current user has seen this note — drives the
   *  unread indicator on the card and the default collapse state
   *  of its thread. Always true for notes the current user wrote. */
  isRead: boolean;
  /** Reactions on this note aggregated by emoji, ordered by the
   *  curated palette. Only non-empty buckets surface. */
  reactions: NoteReactionSummary[];
  /** Tasks added to this note via the "Add task" affordance. */
  attachedTasks: NoteAttachedTask[];
  /** Deadlines added to this note via the "Add deadline" affordance. */
  attachedDeadlines: NoteAttachedDeadline[];
  /** Time entries logged against this note. */
  attachedTimeEntries: NoteAttachedTimeEntry[];
};

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Chip label for a phone number: formatted, or a placeholder. */
export function prettyPhoneForLink(p: string): string {
  return formatPhone(p) || "Unknown number";
}

export function capitalizeKind(k: string): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export async function getMatterNotes(
  matterId: string,
  options: { pinnedOnly?: boolean } = {},
): Promise<NoteRow[]> {
  return getNoteRows({
    matterId,
    ...(options.pinnedOnly ? { isPinned: true } : {}),
  });
}

/** Intake notes on a lead (/intake/[id]/notes) — same row shape as
 *  matter notes. Lead notes carry no entity links or attachments, so
 *  `link` is only ever a parent reply link and the attached lists are
 *  empty. */
export async function getLeadNotes(leadId: string): Promise<NoteRow[]> {
  return getNoteRows({ leadId });
}

async function getNoteRows(where: Prisma.NoteWhereInput): Promise<NoteRow[]> {
  const userId = await getCurrentUserId();
  const rows = await prisma.note.findMany({
    where,
    include: {
      author: { select: { name: true, initials: true } },
      parent: { select: { id: true, content: true } },
      event: { select: EVENT_REF_SELECT },
      task: { select: { id: true, title: true } },
      deadline: { select: { id: true, title: true, dueDate: true } },
      timeEntry: {
        select: { id: true, activity: true, date: true, hours: true },
      },
      // Inbox-action sources: render as "From email" / "From message"
      // chips so users can navigate back to where the note came from.
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
      // Per-user read state — filtered to the current user so we only
      // pull one row per note at most.
      reads: {
        where: { userId },
        select: { userId: true },
        take: 1,
      },
      // All reactions (userId + emoji); we aggregate in-memory below
      // so we can mark which ones the current user participated in.
      reactions: {
        select: { emoji: true, userId: true },
      },
      // Children added via the "Add task / deadline / time" inline
      // composers on the saved-note card. Sort each so the rendered
      // order matches the user's mental model (earliest due first
      // for tasks/deadlines; chronological for time).
      attachedTasks: {
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
        },
      },
      attachedDeadlines: {
        orderBy: [{ dueDate: "asc" }],
        select: {
          id: true,
          title: true,
          status: true,
          kind: true,
          dueDate: true,
        },
      },
      attachedTimeEntries: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: {
          user: { select: { name: true, initials: true } },
        },
      },
    },
    // Pinned first, then creation order (oldest first) so a reply
    // thread reads top-down; the UI groups threads after fetch and
    // reverses the top-level notes itself.
    orderBy: [{ isPinned: "desc" }, { createdAt: "asc" }],
  });

  return rows.map((n) => {
    let link: NoteLink | null = null;
    if (n.parent) {
      link = {
        kind: "parent",
        id: n.parent.id,
        label: truncate(noteToPlainText(n.parent.content), 60) || "note",
      };
    } else if (n.event) {
      link = {
        kind: "event",
        id: n.event.id,
        label: eventLabelForViewer(n.event, userId),
        startTime: n.event.startTime,
      };
    } else if (n.task) {
      link = { kind: "task", id: n.task.id, label: n.task.title };
    } else if (n.deadline) {
      link = {
        kind: "deadline",
        id: n.deadline.id,
        label: n.deadline.title,
        dueDate: n.deadline.dueDate,
      };
    } else if (n.timeEntry) {
      link = {
        kind: "time",
        id: n.timeEntry.id,
        label: `${n.timeEntry.activity} (${n.timeEntry.hours}h)`,
        date: n.timeEntry.date,
      };
    } else if (n.emailThread) {
      link = {
        kind: "email",
        id: n.emailThread.id,
        label: n.emailThread.subject,
      };
    } else if (n.messengerItem) {
      // Messenger items don't have a label; derive one from the
      // thread's contact (or pretty-printed phone fallback).
      const t = n.messengerItem.thread;
      const label = t?.contact?.name ?? prettyPhoneForLink(t?.contactPhone ?? "");
      link = {
        kind: "message",
        // Link by thread id so navigation lands on the conversation
        // (no per-item URL today).
        id: t?.id ?? n.messengerItem.id,
        label: `${capitalizeKind(n.messengerItem.kind)} from ${label}`,
      };
    }

    // Aggregate reactions per emoji, in palette order. Drop unknown
    // emojis defensively (shouldn't happen — action validates against
    // the same palette — but safer than rendering junk).
    const byEmoji = new Map<string, { count: number; userReacted: boolean }>();
    for (const r of n.reactions) {
      if (!(REACTION_EMOJIS as readonly string[]).includes(r.emoji)) continue;
      const entry = byEmoji.get(r.emoji) ?? { count: 0, userReacted: false };
      entry.count += 1;
      if (r.userId === userId) entry.userReacted = true;
      byEmoji.set(r.emoji, entry);
    }
    const reactions = REACTION_EMOJIS.filter((e) => byEmoji.has(e)).map((emoji) => ({
      emoji,
      count: byEmoji.get(emoji)!.count,
      userReacted: byEmoji.get(emoji)!.userReacted,
    }));

    return {
      id: n.id,
      type: n.type,
      content: sanitizeUserHtml(n.content),
      isPinned: n.isPinned,
      authorId: n.authorId,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      parentNoteId: n.parentNoteId,
      link,
      isRead: n.reads.length > 0,
      reactions,
      attachedTasks: n.attachedTasks,
      attachedDeadlines: n.attachedDeadlines,
      attachedTimeEntries: n.attachedTimeEntries.map((t) => ({
        id: t.id,
        date: t.date,
        hours: t.hours,
        activity: t.activity,
        narrative: t.narrative,
        billable: t.billable,
        noCharge: t.noCharge,
        privileged: t.privileged,
        status: t.status,
        userId: t.userId,
        userName: t.user.name,
        userInitials: t.user.initials,
      })),
    };
  });
}
