/**
 * Calendar Queries
 *
 * Fetch calendar events + deadlines that fall within a date range,
 * shaped for the week/month views. Both are rendered together —
 * deadlines are time-less (due by end-of-day) and get distinct
 * visual treatment.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canViewEventDetails } from "@/lib/calendar-visibility";

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
  /** Total attendee count — drives the "+ N attendees" line on
   *  the chip when the chip is tall enough. Cheap aggregate so
   *  the calendar grid doesn't have to ship the full attendee
   *  list for every event. */
  attendeeCount: number;
  /** Up to 3 attendee display names — used by the chip's
   *  "with: A, B, C +N more" line when the chip has room. The
   *  full list lives behind the event detail modal. */
  attendeeNames: string[];
  /** True when the viewer can see full details. False = "Busy"
   *  view. The chip uses this to render either the rich body or
   *  a bare time block; the modal uses it to gate detail
   *  fields. The query strips title/location/etc. when this is
   *  false, so the client can't accidentally leak data. */
  viewerCanSeeDetails: boolean;
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
  // The visibility resolver runs per-event (creator + attendee
  // + matter team + per-event override + creator's user-default
  // override). To answer those questions we pull:
  //   - createdBy.defaultEventVisibility (creator's user-default)
  //   - all attendee userIds (one row per linked-user attendee)
  //   - matter team's active member userIds (when matter event)
  // Everything else stays the same as the prior shape.
  const viewerId = await getCurrentUserId();
  const [events, deadlines] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
      include: {
        matter: {
          select: {
            id: true,
            name: true,
            color: true,
            teamMembers: {
              where: { removedAt: null },
              select: { userId: true },
            },
          },
        },
        createdBy: { select: { defaultEventVisibility: true } },
        // Full attendee list — small in practice (< 10 typical),
        // and needed for both the chip's "with:" line AND the
        // resolver's userId-membership check. Display layer caps
        // at 3 names; the resolver scans userIds.
        attendees: {
          select: { name: true, userId: true },
          orderBy: { name: "asc" },
        },
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

  const mappedEvents: CalendarItem[] = events.map((e) => {
    const attendeeUserIds = e.attendees
      .map((a) => a.userId)
      .filter((id): id is string => !!id);
    const matterTeamUserIds = e.matter?.teamMembers.map((m) => m.userId) ?? [];

    const canSee = canViewEventDetails({
      viewerId,
      createdById: e.createdById,
      eventVisibility: e.visibility,
      creatorDefaultEventVisibility:
        e.createdBy?.defaultEventVisibility ?? null,
      matterId: e.matter?.id ?? null,
      attendeeUserIds,
      matterTeamUserIds,
    });

    if (!canSee) {
      // Strip every detail field server-side so a sniffer
      // can't pull data the viewer isn't supposed to see.
      // Time + isAllDay stay because that IS the busy block.
      // Color falls back to a neutral gray so all "Busy"
      // chips read uniformly regardless of matter.
      return {
        id: e.id,
        kind: "event",
        title: "Busy",
        type: "block_time",
        startTime: e.startTime,
        endTime: e.endTime,
        isAllDay: e.isAllDay,
        location: null,
        color: "var(--color-ink-3)",
        matterId: null,
        matterName: null,
        attendeeCount: 0,
        attendeeNames: [],
        viewerCanSeeDetails: false,
      };
    }

    return {
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
    attendeeCount: e.attendees.length,
    attendeeNames: e.attendees.slice(0, 3).map((a) => a.name),
    viewerCanSeeDetails: true,
    };
  });

  // Note: the "Busy" branch above also returns a CalendarEventRow
  // with `viewerCanSeeDetails: false` and scrubbed fields. The
  // chip render checks the flag and switches to the bare time
  // block; the modal does the same.

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
    /** Set when the attendee is linked to a firm User. The
     *  picker uses this to render an avatar + jobTitle and to
     *  exclude the user from autocomplete results on subsequent
     *  edits. */
    userId: string | null;
    userInitials: string | null;
    userJobTitle: string | null;
    /** Set when the attendee is linked to an existing Contact
     *  (or one created from the arbitrary-name path). The picker
     *  uses this to render a type chip + exclude the contact
     *  from autocomplete on subsequent edits. */
    contactId: string | null;
    contactType: string | null;
    contactOrganization: string | null;
  }>;
  /** True when the viewer can see full details. False = the
   *  fields above are scrubbed (title="Busy", attendees=[], etc.)
   *  and the modal renders a minimal "Busy" view. */
  viewerCanSeeDetails: boolean;
  /** Per-event visibility override. Drives the modal's
   *  "Show details to others" toggle. "default" applies
   *  resolver rules; "show_details" makes the event public. */
  visibility: string;
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
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
      createdBy: { select: { defaultEventVisibility: true } },
      attendees: {
        include: {
          user: {
            select: { id: true, initials: true, jobTitle: true },
          },
          contact: {
            select: { id: true, type: true, organization: true },
          },
        },
      },
    },
  });
  if (!e) return null;

  // Apply the visibility resolver. Modal users who can't see
  // details get a stripped shape — same "Busy" treatment as
  // the calendar grid. Returning null would also work, but the
  // modal needs to render SOMETHING when a user clicks a busy
  // block, so we keep the row + scrub the sensitive bits.
  const viewerId = await getCurrentUserId();
  const attendeeUserIds = e.attendees
    .map((a) => a.userId)
    .filter((uid): uid is string => !!uid);
  const matterTeamUserIds = e.matter?.teamMembers.map((m) => m.userId) ?? [];
  const canSee = canViewEventDetails({
    viewerId,
    createdById: e.createdById,
    eventVisibility: e.visibility,
    creatorDefaultEventVisibility:
      e.createdBy?.defaultEventVisibility ?? null,
    matterId: e.matter?.id ?? null,
    attendeeUserIds,
    matterTeamUserIds,
  });
  if (!canSee) {
    return {
      id: e.id,
      title: "Busy",
      type: "block_time",
      startTime: e.startTime,
      endTime: e.endTime,
      isAllDay: e.isAllDay,
      location: null,
      description: null,
      zoomUrl: null,
      color: "var(--color-ink-3)",
      matter: null,
      attendees: [],
      viewerCanSeeDetails: false,
      visibility: e.visibility,
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
      userId: a.userId,
      userInitials: a.user?.initials ?? null,
      userJobTitle: a.user?.jobTitle ?? null,
      contactId: a.contactId,
      contactType: a.contact?.type ?? null,
      contactOrganization: a.contact?.organization ?? null,
    })),
    viewerCanSeeDetails: true,
    visibility: e.visibility,
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
  /** Null for lead-scoped (intake) entries — TimeEntry.matterId is
   *  nullable since the exactly-one-of-(matterId, leadId) invariant
   *  landed. In practice event-attached entries are always
   *  matter-scoped today (every event composer is a matter surface),
   *  but the type reflects the schema. No consumer reads this
   *  per-row field; the section-level matter comes from the event. */
  matterId: string | null;
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
