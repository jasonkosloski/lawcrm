/**
 * Matter Detail tab queries
 *
 * One per tab — each takes a matterId and returns shaped rows ready
 * for the view layer. Parties, Deadlines, Tasks, Notes, and Documents
 * are the "list" tabs (simple filtered fetches). Timeline and Billing
 * are more complex aggregations and live elsewhere.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import { EXPENSE_ACTIVITY_TITLE_PREFIX } from "@/lib/expense-activity";
import { REACTION_EMOJIS } from "@/lib/note-constants";
import { noteToPlainText } from "@/lib/note-text";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";
import { dateOnlyKey, daysBetweenKeys, todayKey } from "@/lib/format-date";
import { formatPhone } from "@/lib/format-phone";
import type { EventNote, EventTimeEntry } from "@/lib/queries/calendar";

/** The viewer's time zone, resolved lazily so callers that already
 *  know it (or never need it) don't pull the server-only resolver
 *  into their import graph. Date-only "days until" math needs the
 *  viewer's calendar day (ADR-012). */
async function resolveTz(tz?: string): Promise<string> {
  if (tz) return tz;
  const { getCurrentUserTimeZone } = await import("@/lib/current-user-tz");
  return getCurrentUserTimeZone();
}

/** Whole calendar days from the viewer's today to a date-only value
 *  (0 = today, negative = past). Never compares against an instant —
 *  a deadline due today is not "late" until the day is over. */
function daysUntilDueDate(dueDate: Date, tz: string): number {
  return daysBetweenKeys(todayKey(tz), dateOnlyKey(dueDate));
}

// ── Event references from other tabs ─────────────────────────────────────
//
// Deadlines, tasks and notes can point at a calendar event ("From
// event" chips, the Notes tab link). The label is the event title, so
// it obeys the same Busy rule as the calendar and the Events tab
// (canViewEventDetails): a viewer who only sees the event as Busy
// gets "Busy" here too, never the title.

/** Select for an event relation that will be rendered as a label.
 *  Carries everything canViewEventDetails needs. */
const EVENT_REF_SELECT = {
  id: true,
  title: true,
  startTime: true,
  createdById: true,
  visibility: true,
  matterId: true,
  createdBy: { select: { defaultEventVisibility: true } },
  attendees: { select: { userId: true } },
  matter: {
    select: {
      teamMembers: { where: { removedAt: null }, select: { userId: true } },
    },
  },
} satisfies Prisma.CalendarEventSelect;

type EventRef = Prisma.CalendarEventGetPayload<{
  select: typeof EVENT_REF_SELECT;
}>;

/** The event's title, or "Busy" when the viewer may not see its
 *  details. */
export function eventLabelForViewer(event: EventRef, viewerId: string): string {
  const canSee = canViewEventDetails({
    viewerId,
    createdById: event.createdById,
    eventVisibility: event.visibility,
    creatorDefaultEventVisibility:
      event.createdBy?.defaultEventVisibility ?? null,
    matterId: event.matterId,
    attendeeUserIds: event.attendees
      .map((a) => a.userId)
      .filter((id): id is string => !!id),
    matterTeamUserIds: event.matter?.teamMembers.map((m) => m.userId) ?? [],
  });
  return canSee ? event.title : "Busy";
}

/** {id, title} shape resolveEntitySource expects, with the title
 *  scrubbed for viewers who can't see the event. */
function scrubEventRef(
  event: EventRef | null,
  viewerId: string
): { id: string; title: string } | null {
  return event
    ? { id: event.id, title: eventLabelForViewer(event, viewerId) }
    : null;
}

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
   *  `true` means represented (check the rep contact below). */
  isRepresented: boolean | null;
  /** Preferred — the representing attorney as a real Contact row.
   *  When set, the rep cell renders as a clickable link to the
   *  Contact and the firm/email/phone are derived from that Contact
   *  (so an edit on /contacts/[id] flows through everywhere). */
  representationContactId: string | null;
  /** Display fields for the rep cell. When `representationContactId`
   *  is set these mirror the Contact; otherwise they fall back to the
   *  legacy free-text representation* columns on MatterContact. */
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
        // Representing attorney as a first-class Contact. When set,
        // we render the rep cell from this row (and ignore the legacy
        // text columns); when null, fall back to the text columns.
        representationContact: {
          select: {
            id: true,
            name: true,
            organization: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const primaryClientId = matter?.clientId ?? null;

  return rows.map((r) => {
    // Prefer the joined Contact when present so contact-page edits
    // flow through automatically; fall back to the legacy text
    // columns for rows we haven't backfilled yet.
    // The FK decides: when a rep Contact is linked, its fields are
    // the truth even where they have since been cleared — falling
    // back field-by-field would resurrect stale mirrored text (the
    // legacy columns are written once, at save time).
    const repFromContact = r.representationContact;
    const repName = repFromContact
      ? repFromContact.name
      : r.representationName;
    const repFirm = repFromContact
      ? repFromContact.organization
      : r.representationFirm;
    const repEmail = repFromContact
      ? repFromContact.email
      : r.representationEmail;
    const repPhone = repFromContact
      ? repFromContact.phone
      : r.representationPhone;

    return {
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
      representationContactId: r.representationContactId,
      representationName: repName,
      representationFirm: repFirm,
      representationEmail: repEmail,
      representationPhone: repPhone,
      isPrimaryClient:
        r.category === "client" && r.contact.id === primaryClientId,
    };
  });
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

/** Options shared by the deadline / task list queries. */
export type MatterListOptions = {
  /** Viewer's IANA zone for the "days until" math. Resolved from the
   *  session when omitted. */
  tz?: string;
  /** Only rows still needing action (deadlines: open; tasks: open +
   *  in_progress). The Overview preview uses this with `limit`. */
  openOnly?: boolean;
  /** Cap on rows returned (applied after the open-only filter). */
  limit?: number;
};

export async function getMatterDeadlines(
  matterId: string,
  options: MatterListOptions = {}
): Promise<DeadlineRow[]> {
  const [viewerId, tz] = await Promise.all([
    getCurrentUserId(),
    resolveTz(options.tz),
  ]);
  const rows = await prisma.deadline.findMany({
    where: { matterId, ...(options.openOnly ? { status: "open" } : {}) },
    take: options.limit,
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
      parentEvent: { select: EVENT_REF_SELECT },
      parentTask: { select: { id: true, title: true } },
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
    // Status is NOT a DB sort key: alphabetically "completed" < "open",
    // which would bury live deadlines under history. Order by date here
    // and float the open ones in JS below.
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const shaped = rows.map((d) => {
    // dueDate is date-only: compare calendar days in the viewer's zone,
    // not instants (a deadline due today is "0d", never "0d late").
    const daysUntil = daysUntilDueDate(d.dueDate, tz);
    return {
      id: d.id,
      title: d.title,
      dueDate: d.dueDate,
      daysUntil,
      isOverdue: d.status === "open" && daysUntil < 0,
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
        event: scrubEventRef(d.parentEvent, viewerId),
        task: d.parentTask,
      }),
      attachedNotes: d.notes.map((n) => ({
        id: n.id,
        content: sanitizeUserHtml(n.content),
        type: n.type,
        authorName: n.author.name,
        authorInitials: n.author.initials,
        createdAt: n.createdAt,
      })),
    };
  });
  // Open deadlines first, then completed / waived history, each by due
  // date (the page header's promise). Array#sort is stable, so the
  // due-date order from the query survives within each group.
  return shaped.sort(
    (a, b) => Number(a.status !== "open") - Number(b.status !== "open")
  );
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
  const [viewerId, tz] = await Promise.all([
    getCurrentUserId(),
    resolveTz(options.tz),
  ]);
  const rows = await prisma.task.findMany({
    where: {
      matterId,
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
    daysUntilDue: t.dueDate ? daysUntilDueDate(t.dueDate, tz) : null,
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
  event?: { id: string; title: string } | null;
  deadline?: { id: string; title: string } | null;
  task?: { id: string; title: string } | null;
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// Entity-decoded (stored note HTML is "Smith &amp; Jones").
const plainTextFromHtml = noteToPlainText;

/** Chip label for a phone number: formatted, or a placeholder. */
function prettyPhoneForLink(p: string): string {
  return formatPhone(p) || "Unknown number";
}

function capitalizeKind(k: string): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export async function getMatterNotes(
  matterId: string,
  options: { pinnedOnly?: boolean } = {}
): Promise<NoteRow[]> {
  const userId = await getCurrentUserId();
  const rows = await prisma.note.findMany({
    where: { matterId, ...(options.pinnedOnly ? { isPinned: true } : {}) },
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
        label: truncate(plainTextFromHtml(n.parent.content), 60) || "note",
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
  /** Author id - lets the Time tab hide edit/delete from users who
   *  are neither the author nor hold the `_any` permission. */
  userId: string;
  userName: string;
  userInitials: string;
  invoiceId: string | null;
  /** Where this entry was logged from: a note, an email message, a
   *  messenger item, a task, a deadline or a calendar event (event
   *  titles are scrubbed to "Busy" for viewers who can't see them).
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

/// Cap how many rows the Time tab pulls in one shot — same number
/// as MATTER_ACTIVITY_LIMIT on the timeline. Long-running hourly
/// matters accumulate thousands of entries, and each row here drags
/// eight relation includes (note bodies included); entries past the
/// cap need the eventual load-more / paginated viewer. Totals are
/// NOT affected — getMatterTimeSummary aggregates in the database
/// over every row.
const MATTER_TIME_ENTRIES_LIMIT = 200;

export async function getMatterTimeEntries(
  matterId: string,
  options: { limit?: number } = {}
): Promise<TimeEntryRow[]> {
  const viewerId = await getCurrentUserId();
  const rows = await prisma.timeEntry.findMany({
    where: { matterId },
    take: options.limit ?? MATTER_TIME_ENTRIES_LIMIT,
    include: {
      user: { select: { name: true, initials: true } },
      parentNote: { select: { id: true, content: true } },
      parentTask: { select: { id: true, title: true } },
      parentDeadline: { select: { id: true, title: true } },
      // Time logged from the Events tab (calendarEventId) — the chip
      // label obeys the same Busy rule as every other event reference.
      event: { select: EVENT_REF_SELECT },
      // Per-individual-comm sources: time entries logged on a
      // single email message or messenger item. Resolved into the
      // existing email/message EntitySource kinds for chip render.
      emailMessage: {
        select: {
          id: true,
          fromName: true,
          thread: { select: { id: true, subject: true } },
        },
      },
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
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    date: e.date,
    hours: e.hours,
    activity: e.activity,
    narrative: e.narrative,
    utbmsCode: e.utbmsCode,
    // Decimal → number at the API boundary. Same pattern as Matter.trustBalance.
    rate: e.rate?.toNumber() ?? null,
    amount: e.amount?.toNumber() ?? null,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    source: e.source,
    status: e.status,
    userId: e.userId,
    userName: e.user.name,
    userInitials: e.user.initials,
    invoiceId: e.invoiceId,
    spawnedFrom: resolveEntitySource({
      note: e.parentNote,
      // Resolve the per-message source up to the thread for the chip
      // href — there's no per-message detail URL today.
      email: e.emailMessage
        ? {
            id: e.emailMessage.thread.id,
            subject: `${e.emailMessage.thread.subject} (${e.emailMessage.fromName})`,
          }
        : null,
      messenger: e.messengerItem,
      event: scrubEventRef(e.event, viewerId),
      task: e.parentTask,
      deadline: e.parentDeadline,
    }),
    attachedNotes: e.notes.map((n) => ({
      id: n.id,
      content: sanitizeUserHtml(n.content),
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
  // Aggregate in the database instead of fetching rows: the summary
  // must cover EVERY entry the matter ever had (unlike the capped
  // list above), so its cost can't be allowed to grow with row
  // count. groupBy hands back at most billable × noCharge × status
  // buckets (~20) regardless of how many entries exist, and the
  // per-bucket amount sums are computed in Decimal by Postgres —
  // no float accumulation across rows.
  const grouped = await prisma.timeEntry.groupBy({
    by: ["status", "billable", "noCharge"],
    where: { matterId },
    _sum: { hours: true, amount: true },
  });

  let totalHours = 0;
  let billableHours = 0;
  let unbilledAmount = 0;
  let billedAmount = 0;
  for (const g of grouped) {
    const hours = g._sum.hours ?? 0;
    totalHours += hours;
    if (g.billable && !g.noCharge) {
      billableHours += hours;
      // _sum.amount is Prisma.Decimal | null. Convert to number for
      // the running totals — one rounding per bucket is irrelevant;
      // the canonical money lives in the Decimal column.
      const amount = g._sum.amount?.toNumber() ?? 0;
      // Same WIP set the Billing tab uses; written-off entries are in
      // neither bucket. ("billed" = attached to an invoice, draft or
      // sent.)
      if (g.status === "billed") billedAmount += amount;
      else if ((TIME_ENTRY_WIP_STATUSES as readonly string[]).includes(g.status))
        unbilledAmount += amount;
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
  /** False when the viewer may only see this event as "Busy" (same
   *  rule as the calendar, see canViewEventDetails). The row is then
   *  a scrubbed shell: title "Busy", no location / zoom link /
   *  attendee count, and empty notes + timeEntries. The UI hides the
   *  expand affordance for these rows. */
  viewerCanSeeDetails: boolean;
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
  matterId: string,
  options: { tz?: string } = {}
): Promise<MatterEventRow[]> {
  const [viewerId, tz] = await Promise.all([
    getCurrentUserId(),
    resolveTz(options.tz),
  ]);
  const today = todayKey(tz);
  const rows = await prisma.calendarEvent.findMany({
    where: { matterId },
    include: {
      matter: {
        select: {
          color: true,
          // Active team only — same shape getCalendarItems feeds the
          // visibility resolver.
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
      createdBy: { select: { defaultEventVisibility: true } },
      attendees: { select: { userId: true } },
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
  // Timed events are instants (compare to now). All-day events are
  // date-only — still upcoming through the whole of their last day in
  // the viewer's zone, not "past" from 00:00 UTC of that day.
  const isUpcomingEvent = (e: { isAllDay: boolean; endTime: Date }): boolean =>
    e.isAllDay ? dateOnlyKey(e.endTime) >= today : e.endTime.getTime() >= now;
  return rows.map((e): MatterEventRow => {
    const canSee = canViewEventDetails({
      viewerId,
      createdById: e.createdById,
      eventVisibility: e.visibility,
      creatorDefaultEventVisibility:
        e.createdBy?.defaultEventVisibility ?? null,
      matterId: e.matterId,
      attendeeUserIds: e.attendees
        .map((a) => a.userId)
        .filter((id): id is string => !!id),
      matterTeamUserIds: e.matter?.teamMembers.map((m) => m.userId) ?? [],
    });

    if (!canSee) {
      // Busy shell — mirrors getCalendarItems. Id + times stay (the
      // ?event= guard and the upcoming/past split need them); every
      // detail field is stripped server-side so it never reaches the
      // RSC payload.
      return {
        id: e.id,
        title: "Busy",
        type: "block_time",
        startTime: e.startTime,
        endTime: e.endTime,
        isAllDay: e.isAllDay,
        location: null,
        zoomUrl: null,
        color: "var(--color-ink-3)",
        attendeeCount: 0,
        isUpcoming: isUpcomingEvent(e),
        viewerCanSeeDetails: false,
        notes: [],
        timeEntries: [],
      };
    }

    return {
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
      isUpcoming: isUpcomingEvent(e),
      viewerCanSeeDetails: true,
      notes: e.notes.map((n) => ({
        id: n.id,
        type: n.type,
        content: sanitizeUserHtml(n.content),
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
    };
  });
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
  /** True when the document has actual bytes attached. Seeded
   *  fixtures don't (they were created before upload was wired) —
   *  the row UI hides Download for those. */
  hasFile: boolean;
  /** Original uploader's user id; null on seeded / programmatically-
   *  created rows. Drives the "can I delete this?" check on the
   *  row actions menu. */
  uploadedBy: string | null;
  /** Pre-resolved display name for the uploader so the row can show
   *  "by JK" without a second query. */
  uploaderInitials: string | null;
  /** Uploader's full name — tooltip / accessible label next to the
   *  initials. Null on seeded rows or deleted users. */
  uploaderName: string | null;
  /** Folder within the matter's file tree; null = matter root. */
  folderId: string | null;
  createdAt: Date;
};

/** Batch-resolve uploader initials + names (one query, no N+1) and
 *  shape raw Document rows into DocumentRow. */
async function shapeDocumentRows(
  rows: Awaited<ReturnType<typeof prisma.document.findMany>>
): Promise<DocumentRow[]> {
  const uploaderIds = [
    ...new Set(rows.map((d) => d.uploadedBy).filter((v): v is string => !!v)),
  ];
  const uploaders =
    uploaderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, initials: true, name: true },
        })
      : [];
  const byUser = new Map(uploaders.map((u) => [u.id, u]));

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    source: d.source,
    status: d.status,
    fileSize: d.fileSize,
    contentType: d.contentType,
    hasFile: !!d.fileUrl,
    uploadedBy: d.uploadedBy,
    uploaderInitials: d.uploadedBy
      ? byUser.get(d.uploadedBy)?.initials ?? null
      : null,
    uploaderName: d.uploadedBy ? byUser.get(d.uploadedBy)?.name ?? null : null,
    folderId: d.folderId,
    createdAt: d.createdAt,
  }));
}

/** Documents directly inside one folder of the matter's tree
 *  (`folderId: null` = the matter root), ordered by name. The
 *  browser shows one folder at a time — this is its file list. */
export async function getFolderDocuments(
  matterId: string,
  folderId: string | null
): Promise<DocumentRow[]> {
  const rows = await prisma.document.findMany({
    where: { matterId, folderId },
    orderBy: [{ name: "asc" }],
  });
  return shapeDocumentRows(rows);
}

/** The matter's whole folder tree as FLAT rows in ONE query — tree
 *  building (nesting, breadcrumbs, depth math) happens in JS via
 *  src/lib/folder-tree.ts. */
export async function getMatterDocumentFolders(
  matterId: string
): Promise<
  { id: string; parentId: string | null; name: string; order: number }[]
> {
  return prisma.documentFolder.findMany({
    where: { matterId },
    select: { id: true, parentId: true, name: true, order: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
}

/** Direct (non-recursive) document count per folder in one groupBy.
 *  The root's count lives under the `root` key (groupBy can't key a
 *  Record on null). Drives the count badges on the tree rail. */
export async function getFolderDocumentCounts(
  matterId: string
): Promise<{ counts: Record<string, number>; rootCount: number }> {
  const grouped = await prisma.document.groupBy({
    by: ["folderId"],
    where: { matterId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  let rootCount = 0;
  for (const g of grouped) {
    if (g.folderId === null) rootCount = g._count._all;
    else counts[g.folderId] = g._count._all;
  }
  return { counts, rootCount };
}

// ── Matter expenses ────────────────────────────────────────────────────

export type ExpenseRow = {
  id: string;
  date: Date;
  description: string;
  category: string;
  amount: number;
  utbmsCode: string | null;
  billable: boolean;
  clientAdvanced: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  loggerName: string | null;
  loggerInitials: string | null;
  /** When set, the expense has an attached receipt Document.
   *  Drives the "📎 Receipt" chip + open link on the row. */
  receiptDocumentId: string | null;
  receiptDocumentName: string | null;
  /** True when the receipt document has a file blob (downloads
   *  available). Documents created without a file still surface
   *  as a receipt link (chip), just without a download. */
  receiptHasFile: boolean;
};

export type ExpenseSummary = {
  rows: ExpenseRow[];
  /** Sum of all expenses on the matter (every row, regardless of
   *  billable / billed state). Useful for an "expenses to date" KPI. */
  totalAmount: number;
  /** Sum of billable + un-invoiced rows — the candidate set the next
   *  invoice will pull from. */
  billableUnbilledAmount: number;
};

/** Pull every expense row on a matter, ordered newest-first. Joined
 *  to invoice number for the "billed on Invoice X" link, and to the
 *  logger user for attribution on the row. */
export async function getMatterExpenses(
  matterId: string
): Promise<ExpenseSummary> {
  const rows = await prisma.expense.findMany({
    where: { matterId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      invoice: { select: { invoiceNumber: true } },
      receiptDocument: {
        select: { id: true, name: true, fileUrl: true },
      },
    },
  });
  // Resolve loggers in one batch — same pattern as documents.
  const loggerIds = [
    ...new Set(rows.map((r) => r.loggedBy).filter((v): v is string => !!v)),
  ];
  const loggers =
    loggerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: loggerIds } },
          select: { id: true, name: true, initials: true },
        })
      : [];
  const loggerById = new Map(loggers.map((u) => [u.id, u]));

  let totalAmount = 0;
  let billableUnbilledAmount = 0;
  const shaped: ExpenseRow[] = rows.map((r) => {
    const amt = r.amount.toNumber();
    totalAmount += amt;
    if (r.billable && !r.invoiceId) billableUnbilledAmount += amt;
    const logger = r.loggedBy ? loggerById.get(r.loggedBy) : null;
    return {
      id: r.id,
      date: r.date,
      description: r.description,
      category: r.category,
      amount: amt,
      utbmsCode: r.utbmsCode,
      billable: r.billable,
      clientAdvanced: r.clientAdvanced,
      notes: r.notes,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoice?.invoiceNumber ?? null,
      loggerName: logger?.name ?? null,
      loggerInitials: logger?.initials ?? null,
      receiptDocumentId: r.receiptDocument?.id ?? null,
      receiptDocumentName: r.receiptDocument?.name ?? null,
      receiptHasFile: !!r.receiptDocument?.fileUrl,
    };
  });

  return {
    rows: shaped,
    totalAmount,
    billableUnbilledAmount,
  };
}

// ── Matter activity / timeline ─────────────────────────────────────────

export type ActivityRow = {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  iconName: string;
  source: string;
  timestamp: Date;
  /** Author of the action when known. Some actions (seeds, system
   *  events) have null userId — those render with a generic
   *  "system" badge. */
  authorName: string | null;
  authorInitials: string | null;
};

/// Cap how many rows the timeline page pulls in one shot. Matters
/// that age past this number need to switch to the eventual
/// load-more / paginated viewer.
export const MATTER_ACTIVITY_LIMIT = 200;

/** What the viewer may see of money-bearing activity rows. All
 *  default to false (hidden) so a caller that forgets to resolve the
 *  permissions fails closed. */
export type ActivityMoneyAccess = {
  /** Holds matters.settlement.view — settlement / lien rows carry
   *  gross, lienholder and negotiated amounts in their titles. */
  canViewSettlement?: boolean;
  /** Holds matters.expense.view — expense rows (logged as type
   *  "filing", title prefix "Expense ") carry amounts + descriptions. */
  canViewExpense?: boolean;
  /** Holds billing.view - trust deposit / disbursement rows (type
   *  "deposit") carry amounts and ledger movement. */
  canViewBilling?: boolean;
};

/** Prisma AND-clauses that hide the rows a viewer may not see.
 *  Settlement rows are hidden whole (type "settlement"); expense rows
 *  by their title prefix. Exported for tests. */
export function activityMoneyFilters(
  access: ActivityMoneyAccess
): Prisma.ActivityLogWhereInput[] {
  const clauses: Prisma.ActivityLogWhereInput[] = [];
  if (!access.canViewBilling) {
    clauses.push({ type: { not: "deposit" } });
  }
  if (!access.canViewSettlement) {
    clauses.push({ type: { not: "settlement" } });
  }
  if (!access.canViewExpense) {
    clauses.push({
      NOT: {
        type: "filing",
        title: { startsWith: EXPENSE_ACTIVITY_TITLE_PREFIX },
      },
    });
  }
  return clauses;
}

/** Pull the matter's activity log rows (newest first), joined to
 *  the author for display. Optional `types` filter narrows to a
 *  specific category — used by the URL-driven filter pills on the
 *  Timeline tab. Settlement / expense rows are omitted unless the
 *  caller passes the matching `canView*` flag. */
export async function getMatterActivity(
  matterId: string,
  options: {
    types?: readonly string[];
    limit?: number;
  } & ActivityMoneyAccess = {}
): Promise<ActivityRow[]> {
  const where: Prisma.ActivityLogWhereInput = {
    matterId,
    AND: activityMoneyFilters(options),
  };
  if (options.types && options.types.length > 0) {
    where.type = { in: [...options.types] };
  }
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: options.limit ?? MATTER_ACTIVITY_LIMIT,
    include: {
      user: { select: { name: true, initials: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    detail: r.detail,
    iconName: r.icon ?? "zap",
    source: r.source ?? "System",
    timestamp: r.timestamp,
    authorName: r.user?.name ?? null,
    authorInitials: r.user?.initials ?? null,
  }));
}

/** Counts every type bucket on the matter, keyed by `type`. Drives
 *  the filter pills' badge counts so the user can see "8 emails / 3
 *  filings / 12 notes" before clicking. */
export async function getMatterActivityTypeCounts(
  matterId: string,
  access: ActivityMoneyAccess = {}
): Promise<Record<string, number>> {
  const grouped = await prisma.activityLog.groupBy({
    by: ["type"],
    where: { matterId, AND: activityMoneyFilters(access) },
    _count: { type: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.type] = g._count.type;
  return out;
}
