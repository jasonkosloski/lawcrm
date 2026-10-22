/**
 * Matter / lead Events tab readers.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { dateOnlyKey, todayKey } from "@/lib/format-date";
import type { EventNote, EventTimeEntry } from "@/lib/queries/calendar";
import { resolveTz } from "./shared";

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
  options: { tz?: string } = {},
): Promise<MatterEventRow[]> {
  return getEventRows({ matterId }, options);
}

/** Intake events on a lead (/intake/[id]/events). Same row shape and
 *  visibility rules as matter events; with no matter team, only the
 *  creator, attendees and `show_details` events show in full. */
export async function getLeadEvents(
  leadId: string,
  options: { tz?: string } = {},
): Promise<MatterEventRow[]> {
  return getEventRows({ leadId }, options);
}

async function getEventRows(
  where: Prisma.CalendarEventWhereInput,
  options: { tz?: string },
): Promise<MatterEventRow[]> {
  const [viewerId, tz] = await Promise.all([getCurrentUserId(), resolveTz(options.tz)]);
  const today = todayKey(tz);
  const rows = await prisma.calendarEvent.findMany({
    where,
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
      creatorDefaultEventVisibility: e.createdBy?.defaultEventVisibility ?? null,
      matterId: e.matterId,
      attendeeUserIds: e.attendees.map((a) => a.userId).filter((id): id is string => !!id),
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
