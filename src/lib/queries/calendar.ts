/**
 * Calendar Queries
 *
 * Fetch calendar events + deadlines that fall within a date range,
 * shaped for the week/month views. Both are rendered together —
 * deadlines are time-less (due by end-of-day) and get distinct
 * visual treatment.
 *
 * ## Dates (ADR-012)
 *
 * The caller passes the range as INSTANTS (the viewer's first
 * midnight to last 23:59, from `calendarWeekInTz` & co.). Two kinds of
 * rows are matched against it differently:
 *
 *   - Timed events are instants: matched by OVERLAP with the range, so
 *     an event that started before it (or spans midnight) still shows.
 *   - Deadlines (`dueDate`) and all-day events are date-only values
 *     stored at UTC midnight. The range is converted to inclusive day
 *     keys in the viewer's zone and matched with `dateOnlyRange`;
 *     filtering them by the instant range misplaces them by a day for
 *     anyone west of UTC. Consumers bucket them with `dateOnlyKey`
 *     (never `dateKeyInTz`) — see `eventDayKeys` in calendar-utils.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import {
  canAccessMatter,
  filterAccessibleMatterIds,
  matterRelationAccessWhere,
} from "@/lib/matter-access";
import { canAccessLead, filterAccessibleLeadIds } from "@/lib/lead-access";
import { dateKeyInTz, dateOnlyRange } from "@/lib/format-date";

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

/** Inclusive first/last day keys of an instant range, in the viewer's
 *  zone, as the date-only bounds deadlines and all-day events match. */
function dayBoundsOf(rangeStart: Date, rangeEnd: Date, tz: string) {
  return dateOnlyRange(dateKeyInTz(rangeStart, tz), dateKeyInTz(rangeEnd, tz));
}

/** Prisma `where` selecting the events that touch the range:
 *  timed events by instant overlap, all-day events by day-key overlap.
 *  (A timed event ending exactly at the range start doesn't count,
 *  but a zero-length one starting at it does.) */
function eventsInRangeWhere(
  rangeStart: Date,
  rangeEnd: Date,
  tz: string
): Prisma.CalendarEventWhereInput {
  const days = dayBoundsOf(rangeStart, rangeEnd, tz);
  return {
    OR: [
      {
        isAllDay: false,
        startTime: { lte: rangeEnd },
        OR: [
          { endTime: { gt: rangeStart } },
          { startTime: { gte: rangeStart } },
        ],
      },
      {
        isAllDay: true,
        startTime: { lt: days.lt },
        endTime: { gte: days.gte },
      },
    ],
  };
}

export async function getCalendarItems(
  rangeStart: Date,
  rangeEnd: Date,
  /** The viewer's zone; resolved from the session when omitted. */
  tzArg?: string
): Promise<CalendarItem[]> {
  const tz = tzArg ?? (await getCurrentUserTimeZone());
  // The visibility resolver runs per-event (creator + attendee
  // + matter team + per-event override + creator's user-default
  // override). To answer those questions we pull:
  //   - createdBy.defaultEventVisibility (creator's user-default)
  //   - all attendee userIds (one row per linked-user attendee)
  //   - matter team's active member userIds (when matter event)
  // Everything else stays the same as the prior shape.
  const viewerId = await getCurrentUserId();
  // Matter wall: deadlines on matters the viewer can't access are
  // dropped; EVENTS on them stay as "Busy" blocks (time is shared,
  // details aren't) - see canViewEventDetails.matterAccessible.
  const deadlineAccess = await matterRelationAccessWhere(viewerId);
  const [events, deadlines] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: eventsInRangeWhere(rangeStart, rangeEnd, tz),
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
        lead: { select: { name: true } },
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
        dueDate: dayBoundsOf(rangeStart, rangeEnd, tz),
        status: "open",
        ...deadlineAccess,
      },
      include: {
        matter: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // One query for the whole batch: which of the events' matters can
  // the viewer see?
  const accessibleMatters = await filterAccessibleMatterIds(
    viewerId,
    events.flatMap((e) => (e.matter ? [e.matter.id] : []))
  );
  // Restricted intake (ADR-049): events on hidden leads are Busy too.
  const accessibleLeads = await filterAccessibleLeadIds(
    viewerId,
    events.flatMap((e) => (e.leadId ? [e.leadId] : []))
  );

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
      matterAccessible: e.matter ? accessibleMatters.has(e.matter.id) : true,
      leadId: e.leadId,
      leadAccessible: e.leadId ? accessibleLeads.has(e.leadId) : true,
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
    // Intake events show their lead as the context line.
    matterName:
      e.matter?.name ?? (e.lead ? `Intake · ${e.lead.name}` : null),
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
  /** The intake lead an intake event is on (CalendarEvent.leadId);
   *  null otherwise, and on a Busy shell. */
  lead: { id: string; name: string } | null;
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
      lead: { select: { id: true, name: true } },
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
    matterAccessible: e.matter
      ? await canAccessMatter(viewerId, e.matter.id)
      : true,
    leadId: e.leadId,
    leadAccessible: e.leadId ? await canAccessLead(viewerId, e.leadId) : true,
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
      lead: null,
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
    lead: e.lead,
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
  /** Author's user id — lets the UI hide Delete on a colleague's note
   *  the viewer isn't allowed to delete. Optional: rows built by other
   *  queries (matter Events tab) may omit it, which leaves the decision
   *  to the server. */
  authorId?: string;
  authorName: string;
  authorInitials: string;
  createdAt: Date;
  /** Matter the note belongs to — needed so delete/pin server actions
   *  can revalidate the right paths from the modal. Nullable only
   *  because Note.matterId is (intake notes, which are never
   *  event-linked); event notes always carry a matter. */
  matterId: string | null;
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
  /** Entry owner's user id — same purpose as `EventNote.authorId`. */
  userId?: string;
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
    userId: e.userId,
    userName: e.user.name,
    userInitials: e.user.initials,
    matterId: e.matterId,
  }));
}

/** Notes directly attached to a specific calendar event (calendarEventId
 *  FK). Sorted pinned-first / most-recent-first so the most important
 *  court notes surface at the top. Every note carrying the event's id
 *  is returned flat — replies (parentNoteId set) are NOT threaded or
 *  filtered here; the matter's Notes tab is the threaded surface. */
export async function getEventNotes(eventId: string): Promise<EventNote[]> {
  const rows = await prisma.note.findMany({
    where: { calendarEventId: eventId },
    include: { author: { select: { name: true, initials: true } } },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    content: sanitizeUserHtml(n.content),
    isPinned: n.isPinned,
    authorId: n.authorId,
    authorName: n.author.name,
    authorInitials: n.author.initials,
    createdAt: n.createdAt,
    matterId: n.matterId,
  }));
}
