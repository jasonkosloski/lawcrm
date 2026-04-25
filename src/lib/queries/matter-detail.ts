/**
 * Matter Detail tab queries
 *
 * One per tab — each takes a matterId and returns shaped rows ready
 * for the view layer. Parties, Deadlines, Tasks, Notes, and Documents
 * are the "list" tabs (simple filtered fetches). Timeline and Billing
 * are more complex aggregations and live elsewhere.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { REACTION_EMOJIS } from "@/lib/note-constants";
import type { EventNote, EventTimeEntry } from "@/lib/queries/calendar";

// ── Parties ──────────────────────────────────────────────────────────────

export type ContactPhoneRow = {
  id: string;
  label: string | null;
  number: string;
  isPrimary: boolean;
};

export type PartyRow = {
  /** matterContact row id — used for delete/unlink. */
  id: string;
  contactId: string;
  name: string;
  organization: string | null;
  email: string | null;
  /** Denormalized primary phone — same as phones.find(p=>p.isPrimary).
   *  Kept as its own field so existing readers don't have to walk
   *  the array. Nullable when the contact has no phones at all. */
  phone: string | null;
  /** Full list of phones in display order (primary first). */
  phones: ContactPhoneRow[];
  contactType: string;
  /** True when this row represents the matter's primary client
   *  (Matter.clientId points at this contactId and category is
   *  "client"). The UI pins it, disables delete, and shows a
   *  "Primary" badge. */
  isPrimaryClient: boolean;
  /** Coarse display bucket — client / opposing / lay_witness /
   *  expert_witness / other. */
  category: string;
  /** Optional finer-grained subrole — plaintiff, defendant,
   *  opposing counsel, GAL, medical provider, etc. */
  role: string | null;
  notes: string | null;
  conflictStatus: string;
  /** Representation info for non-client parties. `null` means
   *  unknown; `false` means explicitly pro se / self-represented;
   *  `true` means represented (check the name/firm/email/phone
   *  fields for the rep's contact info). */
  isRepresented: boolean | null;
  representationName: string | null;
  representationFirm: string | null;
  representationEmail: string | null;
  representationPhone: string | null;
};

export async function getMatterParties(matterId: string): Promise<PartyRow[]> {
  const [matter, rows] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { clientId: true },
    }),
    prisma.matterContact.findMany({
      where: { matterId },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            organization: true,
            email: true,
            phone: true,
            type: true,
            conflictStatus: true,
            phones: {
              orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
              select: {
                id: true,
                label: true,
                number: true,
                isPrimary: true,
              },
            },
          },
        },
      },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const primaryClientId = matter?.clientId ?? null;

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact.id,
    name: r.contact.name,
    organization: r.contact.organization,
    email: r.contact.email,
    phone: r.contact.phone,
    phones: r.contact.phones,
    contactType: r.contact.type,
    category: r.category,
    role: r.role,
    notes: r.notes,
    conflictStatus: r.contact.conflictStatus,
    isRepresented: r.isRepresented,
    representationName: r.representationName,
    representationFirm: r.representationFirm,
    representationEmail: r.representationEmail,
    representationPhone: r.representationPhone,
    isPrimaryClient:
      r.category === "client" && r.contact.id === primaryClientId,
  }));
}

// ── Deadlines ────────────────────────────────────────────────────────────

export type DeadlineRow = {
  id: string;
  title: string;
  dueDate: Date;
  daysUntil: number;
  isOverdue: boolean;
  kind: string;
  /** Legal source of the deadline (statute / scheduling order / rule).
   *  Distinct from `spawnedFrom` (which captures *which surface* the
   *  user used to create the deadline — note / email / messenger). */
  sourceType: string | null;
  sourceRef: string | null;
  description: string | null;
  status: string;
  ownerName: string | null;
  ownerInitials: string | null;
  spawnedFrom: EntitySource | null;
  attachedNotes: AttachedNotePreview[];
};

export async function getMatterDeadlines(
  matterId: string
): Promise<DeadlineRow[]> {
  const rows = await prisma.deadline.findMany({
    where: { matterId },
    include: {
      owner: { select: { name: true, initials: true } },
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
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
  const now = Date.now();
  return rows.map((d) => {
    const diffMs = d.dueDate.getTime() - now;
    const daysUntil = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return {
      id: d.id,
      title: d.title,
      dueDate: d.dueDate,
      daysUntil,
      isOverdue: d.status === "open" && diffMs < 0,
      kind: d.kind,
      sourceType: d.sourceType,
      sourceRef: d.sourceRef,
      description: d.description,
      status: d.status,
      ownerName: d.owner?.name ?? null,
      ownerInitials: d.owner?.initials ?? null,
      spawnedFrom: resolveEntitySource({
        note: d.parentNote,
        email: d.emailThread,
        messenger: d.messengerItem,
      }),
      attachedNotes: d.notes.map((n) => ({
        id: n.id,
        content: n.content,
        type: n.type,
        authorName: n.author.name,
        authorInitials: n.author.initials,
        createdAt: n.createdAt,
      })),
    };
  });
}

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
  | { kind: "message"; id: string; label: string };

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: Date | null;
  daysUntilDue: number | null;
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

export async function getMatterTasks(matterId: string): Promise<TaskRow[]> {
  const rows = await prisma.task.findMany({
    where: { matterId },
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
  const now = Date.now();
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    daysUntilDue: t.dueDate
      ? Math.ceil((t.dueDate.getTime() - now) / (24 * 60 * 60 * 1000))
      : null,
    ownerName: t.owner?.name ?? null,
    ownerInitials: t.owner?.initials ?? null,
    createdAt: t.createdAt,
    spawnedFrom: resolveEntitySource({
      note: t.parentNote,
      email: t.emailThread,
      messenger: t.messengerItem,
    }),
    attachedNotes: t.notes.map((n) => ({
      id: n.id,
      content: n.content,
      type: n.type,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
    })),
  }));
}

/** Pick the first populated source FK in priority order and turn it
 *  into the typed EntitySource shape the UI expects. */
function resolveEntitySource(refs: {
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
}): EntitySource | null {
  if (refs.note) {
    return {
      kind: "note",
      id: refs.note.id,
      label: truncate(plainTextFromHtml(refs.note.content), 60) || "note",
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
  return null;
}

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
  userName: string;
  userInitials: string;
};

export type NoteRow = {
  id: string;
  type: string;
  content: string;
  isPinned: boolean;
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Local copy of the messenger phone formatter used by the messenger
 *  components — kept inline here so this query module doesn't need
 *  to depend on a UI util just for the link-chip label. */
function prettyPhoneForLink(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p || "Unknown number";
}

function capitalizeKind(k: string): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export async function getMatterNotes(matterId: string): Promise<NoteRow[]> {
  const userId = await getCurrentUserId();
  const rows = await prisma.note.findMany({
    where: { matterId },
    include: {
      author: { select: { name: true, initials: true } },
      parent: { select: { id: true, content: true } },
      event: { select: { id: true, title: true, startTime: true } },
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
    // Replies sort by creation so the thread reads top-down. Top-level
    // notes use the pinned-first / most-recent ordering; the UI does
    // the thread grouping after fetch.
    orderBy: [{ isPinned: "desc" }, { createdAt: "asc" }],
  });

  return rows.map((n) => {
    let link: NoteLink | null = null;
    if (n.parent) {
      link = {
        kind: "parent",
        id: n.parent.id,
        label: truncate(plainTextFromHtml(n.parent.content), 60) || "note",
      };
    } else if (n.event) {
      link = {
        kind: "event",
        id: n.event.id,
        label: n.event.title,
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
      const label =
        t?.contact?.name ?? prettyPhoneForLink(t?.contactPhone ?? "");
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
    const reactions = REACTION_EMOJIS.filter((e) => byEmoji.has(e)).map(
      (emoji) => ({
        emoji,
        count: byEmoji.get(emoji)!.count,
        userReacted: byEmoji.get(emoji)!.userReacted,
      })
    );

    return {
      id: n.id,
      type: n.type,
      content: n.content,
      isPinned: n.isPinned,
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
        userName: t.user.name,
        userInitials: t.user.initials,
      })),
    };
  });
}

// ── Time entries ─────────────────────────────────────────────────────────

export type TimeEntryRow = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  utbmsCode: string | null;
  rate: number | null;
  amount: number | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  source: string;
  status: string;
  userName: string;
  userInitials: string;
  invoiceId: string | null;
  /** Where this entry was logged from. Today only the "note" kind
   *  fires for time entries (email + messenger sources don't spawn
   *  time entries — the user's working session goes there directly).
   *  Same field shape as TaskRow / DeadlineRow for chip-render reuse. */
  spawnedFrom: EntitySource | null;
  attachedNotes: AttachedNotePreview[];
};

export type MatterTimeSummary = {
  totalHours: number;
  billableHours: number;
  unbilledAmount: number;
  billedAmount: number;
};

export async function getMatterTimeEntries(
  matterId: string
): Promise<TimeEntryRow[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { matterId },
    include: {
      user: { select: { name: true, initials: true } },
      parentNote: { select: { id: true, content: true } },
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
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    date: e.date,
    hours: e.hours,
    activity: e.activity,
    narrative: e.narrative,
    utbmsCode: e.utbmsCode,
    rate: e.rate,
    amount: e.amount,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    source: e.source,
    status: e.status,
    userName: e.user.name,
    userInitials: e.user.initials,
    invoiceId: e.invoiceId,
    spawnedFrom: resolveEntitySource({
      note: e.parentNote,
      email: null,
      messenger: null,
    }),
    attachedNotes: e.notes.map((n) => ({
      id: n.id,
      content: n.content,
      type: n.type,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
    })),
  }));
}

export async function getMatterTimeSummary(
  matterId: string
): Promise<MatterTimeSummary> {
  const entries = await prisma.timeEntry.findMany({
    where: { matterId },
    select: {
      hours: true,
      amount: true,
      billable: true,
      noCharge: true,
      status: true,
    },
  });

  let totalHours = 0;
  let billableHours = 0;
  let unbilledAmount = 0;
  let billedAmount = 0;
  for (const e of entries) {
    totalHours += e.hours;
    if (e.billable && !e.noCharge) {
      billableHours += e.hours;
      const amount = e.amount ?? 0;
      if (e.status === "billed") billedAmount += amount;
      else unbilledAmount += amount;
    }
  }
  return { totalHours, billableHours, unbilledAmount, billedAmount };
}

// ── Events ───────────────────────────────────────────────────────────────

export type MatterEventRow = {
  id: string;
  title: string;
  type: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
  zoomUrl: string | null;
  color: string;
  attendeeCount: number;
  /** True when the event is in the future relative to "now". */
  isUpcoming: boolean;
  /** All notes attached to this event, pinned-first / most-recent-
   *  first. The Events tab renders these inline in an expandable
   *  section under the row; the event detail modal uses the
   *  getEventNotes query instead. */
  notes: EventNote[];
  /** All time entries attached to this event, most-recent-first.
   *  Surfaced inline in the expandable section alongside notes. */
  timeEntries: EventTimeEntry[];
};

export async function getMatterEvents(
  matterId: string
): Promise<MatterEventRow[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: { matterId },
    include: {
      matter: { select: { color: true } },
      _count: { select: { attendees: true } },
      notes: {
        include: { author: { select: { name: true, initials: true } } },
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      },
      timeEntries: {
        include: { user: { select: { name: true, initials: true } } },
        orderBy: { date: "desc" },
      },
    },
    orderBy: { startTime: "asc" },
  });
  const now = Date.now();
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
    isAllDay: e.isAllDay,
    location: e.location,
    zoomUrl: e.zoomUrl,
    color: e.matter?.color ?? e.color ?? "var(--color-ink-3)",
    attendeeCount: e._count.attendees,
    isUpcoming: e.endTime.getTime() >= now,
    notes: e.notes.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content,
      isPinned: n.isPinned,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
      matterId: n.matterId,
    })),
    timeEntries: e.timeEntries.map((t) => ({
      id: t.id,
      date: t.date,
      hours: t.hours,
      activity: t.activity,
      narrative: t.narrative,
      billable: t.billable,
      noCharge: t.noCharge,
      privileged: t.privileged,
      status: t.status,
      userName: t.user.name,
      userInitials: t.user.initials,
      matterId: t.matterId,
    })),
  }));
}

// ── Documents ────────────────────────────────────────────────────────────

export type DocumentRow = {
  id: string;
  name: string;
  category: string;
  source: string | null;
  status: string;
  fileSize: number | null;
  contentType: string | null;
  createdAt: Date;
};

export async function getMatterDocuments(
  matterId: string
): Promise<DocumentRow[]> {
  const rows = await prisma.document.findMany({
    where: { matterId },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    source: d.source,
    status: d.status,
    fileSize: d.fileSize,
    contentType: d.contentType,
    createdAt: d.createdAt,
  }));
}
