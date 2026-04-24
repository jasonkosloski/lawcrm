/**
 * Calendar Queries
 *
 * Fetch calendar events + deadlines that fall within a date range,
 * shaped for the week/month views. Both are rendered together —
 * deadlines are time-less (due by end-of-day) and get distinct
 * visual treatment.
 */

import { prisma } from "@/lib/prisma";

export type CalendarEventRow = {
  id: string;
  kind: "event";
  title: string;
  type: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
  /** Matter color if the event is linked to a matter; fallback ink-3. */
  color: string;
  matterId: string | null;
  matterName: string | null;
};

export type CalendarDeadlineRow = {
  id: string;
  kind: "deadline";
  title: string;
  dueDate: Date;
  /** `critical` / `auto_rule` / `manual` — drives the chip color. */
  deadlineKind: string;
  status: string;
  matterId: string;
  matterName: string;
};

export type CalendarItem = CalendarEventRow | CalendarDeadlineRow;

export async function getCalendarItems(
  rangeStart: Date,
  rangeEnd: Date
): Promise<CalendarItem[]> {
  const [events, deadlines] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
      include: {
        matter: { select: { id: true, name: true, color: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.deadline.findMany({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
      },
      include: {
        matter: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const mappedEvents: CalendarItem[] = events.map((e) => ({
    id: e.id,
    kind: "event",
    title: e.title,
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
    isAllDay: e.isAllDay,
    location: e.location,
    color: e.matter?.color ?? e.color ?? "var(--color-ink-3)",
    matterId: e.matter?.id ?? null,
    matterName: e.matter?.name ?? null,
  }));

  const mappedDeadlines: CalendarItem[] = deadlines.map((d) => ({
    id: d.id,
    kind: "deadline",
    title: d.title,
    dueDate: d.dueDate,
    deadlineKind: d.kind,
    status: d.status,
    matterId: d.matter.id,
    matterName: d.matter.name,
  }));

  return [...mappedEvents, ...mappedDeadlines];
}

/** Full details for a single event — used by the event detail modal. */
export type CalendarEventDetail = {
  id: string;
  title: string;
  type: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  zoomUrl: string | null;
  color: string;
  matter: { id: string; name: string; area: string; color: string } | null;
  attendees: Array<{
    id: string;
    name: string;
    email: string | null;
    status: string;
  }>;
};

export async function getCalendarEventById(
  id: string
): Promise<CalendarEventDetail | null> {
  const e = await prisma.calendarEvent.findUnique({
    where: { id },
    include: {
      matter: {
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
        },
      },
      attendees: true,
    },
  });
  if (!e) return null;
  return {
    id: e.id,
    title: e.title,
    type: e.type,
    startTime: e.startTime,
    endTime: e.endTime,
    isAllDay: e.isAllDay,
    location: e.location,
    description: e.description,
    zoomUrl: e.zoomUrl,
    color: e.matter?.color ?? e.color ?? "var(--color-ink-3)",
    matter: e.matter
      ? {
          id: e.matter.id,
          name: e.matter.name,
          color: e.matter.color,
          area: e.matter.practiceArea.name,
        }
      : null,
    attendees: e.attendees.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      status: a.status,
    })),
  };
}

/** Shape used by the event detail modal's notes section. Compact —
 *  not threaded, not filterable; the matter's Notes tab is the full
 *  surface for that. */
export type EventNote = {
  id: string;
  type: string;
  content: string;
  isPinned: boolean;
  authorName: string;
  authorInitials: string;
  createdAt: Date;
  /** Matter the note belongs to — needed so delete/pin server actions
   *  can revalidate the right paths from the modal. */
  matterId: string;
};

/** Shape used by the event detail modal's time entries section. */
export type EventTimeEntry = {
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
  matterId: string;
};

/** Time entries directly attached to a specific calendar event
 *  (calendarEventId FK). Sorted most-recent-first so new logs bubble
 *  up. */
export async function getEventTimeEntries(
  eventId: string
): Promise<EventTimeEntry[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { calendarEventId: eventId },
    include: { user: { select: { name: true, initials: true } } },
    orderBy: { date: "desc" },
  });
  return rows.map((e) => ({
    id: e.id,
    date: e.date,
    hours: e.hours,
    activity: e.activity,
    narrative: e.narrative,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    status: e.status,
    userName: e.user.name,
    userInitials: e.user.initials,
    matterId: e.matterId,
  }));
}

/** Notes directly attached to a specific calendar event (calendarEventId
 *  FK). Sorted pinned-first / most-recent-first so the most important
 *  court notes surface at the top. Replies (notes with parentNoteId
 *  set) are included only when their parent is also attached to this
 *  event — keeps the modal focused without fragmenting threads. */
export async function getEventNotes(eventId: string): Promise<EventNote[]> {
  const rows = await prisma.note.findMany({
    where: { calendarEventId: eventId },
    include: { author: { select: { name: true, initials: true } } },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    content: n.content,
    isPinned: n.isPinned,
    authorName: n.author.name,
    authorInitials: n.author.initials,
    createdAt: n.createdAt,
    matterId: n.matterId,
  }));
}

/** Summary counts for the top-bar crumb. */
export async function getCalendarSummary(
  rangeStart: Date,
  rangeEnd: Date
): Promise<{
  events: number;
  deadlines: number;
  criticalDeadlines: number;
}> {
  const [events, deadlines, critical] = await Promise.all([
    prisma.calendarEvent.count({
      where: { startTime: { gte: rangeStart, lte: rangeEnd } },
    }),
    prisma.deadline.count({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
      },
    }),
    prisma.deadline.count({
      where: {
        dueDate: { gte: rangeStart, lte: rangeEnd },
        status: "open",
        kind: "critical",
      },
    }),
  ]);
  return { events, deadlines, criticalDeadlines: critical };
}
