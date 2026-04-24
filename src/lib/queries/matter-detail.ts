/**
 * Matter Detail tab queries
 *
 * One per tab — each takes a matterId and returns shaped rows ready
 * for the view layer. Parties, Deadlines, Tasks, Notes, and Documents
 * are the "list" tabs (simple filtered fetches). Timeline and Billing
 * are more complex aggregations and live elsewhere.
 */

import { prisma } from "@/lib/prisma";
import type { EventNote, EventTimeEntry } from "@/lib/queries/calendar";

// ── Parties ──────────────────────────────────────────────────────────────

export type PartyRow = {
  id: string;
  contactId: string;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  contactType: string;
  /** Role *on this matter* (e.g. plaintiff / defendant / witness). */
  role: string;
  notes: string | null;
  conflictStatus: string;
};

export async function getMatterParties(matterId: string): Promise<PartyRow[]> {
  const rows = await prisma.matterContact.findMany({
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
        },
      },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact.id,
    name: r.contact.name,
    organization: r.contact.organization,
    email: r.contact.email,
    phone: r.contact.phone,
    contactType: r.contact.type,
    role: r.role,
    notes: r.notes,
    conflictStatus: r.contact.conflictStatus,
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
  sourceType: string | null;
  sourceRef: string | null;
  description: string | null;
  status: string;
  ownerName: string | null;
  ownerInitials: string | null;
};

export async function getMatterDeadlines(
  matterId: string
): Promise<DeadlineRow[]> {
  const rows = await prisma.deadline.findMany({
    where: { matterId },
    include: {
      owner: { select: { name: true, initials: true } },
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
    };
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────

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
};

export async function getMatterTasks(matterId: string): Promise<TaskRow[]> {
  const rows = await prisma.task.findMany({
    where: { matterId },
    include: { owner: { select: { name: true, initials: true } } },
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
  }));
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
  | { kind: "parent"; id: string; label: string };

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

export async function getMatterNotes(matterId: string): Promise<NoteRow[]> {
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
    }

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
    include: { user: { select: { name: true, initials: true } } },
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
