/**
 * Default attendees for a freshly created matter calendar event.
 *
 * Shared by every path that mints an event on a matter (the Events
 * composer, sibling `event` captures from notes / task / deadline /
 * time composers, and the bulk-attach action) so they all uphold the
 * min-firm-attendee invariant: an event never exists without at
 * least one firm attendee.
 *
 * Runs INSIDE the caller's transaction, right after the event row is
 * created. `autoAddTeam` is the resolved
 * `getEffectiveCalendarDefaults(matterId).autoAddTeamToNewEvents`
 * (resolved before the transaction so the team query can be skipped
 * entirely when it is off).
 */

import type { Tx } from "@/lib/prisma";
import { getEffectiveCalendarDefaults } from "@/lib/calendar-defaults";

/** Resolve `autoAddTeamToNewEvents` for a matter, but only when the
 *  capture list actually carries an `event` — otherwise skip the two
 *  settings queries. Call BEFORE opening the transaction. */
export async function resolveAutoAddTeam(
  matterId: string,
  captures: ReadonlyArray<{ kind: string }>,
): Promise<boolean> {
  if (!captures.some((c) => c.kind === "event")) return false;
  return (await getEffectiveCalendarDefaults(matterId)).autoAddTeamToNewEvents;
}

export async function addDefaultEventAttendees(
  tx: Tx,
  args: {
    eventId: string;
    /** Null for an event with no matter team (an intake event on a
     *  lead): only the creator is added. */
    matterId: string | null;
    userId: string;
    autoAddTeam: boolean;
  },
): Promise<void> {
  const { eventId, matterId, userId, autoAddTeam } = args;
  // Auto-add matter team members as attendees when the effective
  // setting says so. Each team member becomes a typed `kind: user`
  // attendee — same shape the modal picker creates. We snapshot
  // name/email so a future user rename doesn't silently rewrite past
  // attendance.
  //
  // The creator is added either as part of the team list (when they
  // are on the matter team) or as a fallback after the team-add block
  // — either way, the min-firm-attendee invariant holds.
  const creator = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });
  let creatorAlreadyAdded = false;
  if (autoAddTeam && matterId) {
    const team = await tx.matterTeamMember.findMany({
      where: { matterId, removedAt: null },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (team.length > 0) {
      await tx.calendarAttendee.createMany({
        // Auto-added teammates are implicitly attending — the event
        // was just created on their matter. Status `accepted`
        // suppresses the modal's pending pill.
        data: team.map((t) => ({
          eventId,
          userId: t.user.id,
          name: t.user.name,
          email: t.user.email,
          status: "accepted",
        })),
      });
      if (team.some((t) => t.user.id === userId)) creatorAlreadyAdded = true;
    }
  }
  if (!creatorAlreadyAdded) {
    await tx.calendarAttendee.create({
      data: {
        eventId,
        userId,
        name: creator.name,
        email: creator.email,
        status: "accepted",
      },
    });
  }
}
