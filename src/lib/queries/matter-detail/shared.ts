/**
 * Helpers shared by the matter-detail tab readers: the viewer's time
 * zone and the event-reference scrub used by tabs that link to
 * calendar events.
 */

import type { Prisma } from "@/generated/prisma/client";
import { canViewEventDetails } from "@/lib/calendar-visibility";

/** The viewer's time zone, resolved lazily so callers that already
 *  know it (or never need it) don't pull the server-only resolver
 *  into their import graph. Date-only "days until" math needs the
 *  viewer's calendar day (ADR-012). */
export async function resolveTz(tz?: string): Promise<string> {
  if (tz) return tz;
  const { getCurrentUserTimeZone } = await import("@/lib/current-user-tz");
  return getCurrentUserTimeZone();
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
export const EVENT_REF_SELECT = {
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
export function scrubEventRef(
  event: EventRef | null,
  viewerId: string
): { id: string; title: string } | null {
  return event
    ? { id: event.id, title: eventLabelForViewer(event, viewerId) }
    : null;
}
