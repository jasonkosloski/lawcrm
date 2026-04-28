/**
 * Calendar default settings — server-only.
 *
 * Two firm-wide-with-per-matter-override switches drive the
 * "should we auto-add team members to events?" behavior:
 *
 *   - autoAddTeamToNewEvents:
 *       Newly created calendar events on the matter get every
 *       active matter team member as a default attendee.
 *
 *   - autoAddTeamToUpcomingEvents:
 *       When a team member is added to a matter, they're
 *       attached as an attendee on every upcoming event the
 *       matter already has on the books.
 *
 * Resolution model: matter override wins when set, otherwise
 * fall back to the firm value. Both fields default to true at
 * the firm level — it's the behavior most teams want, and the
 * UI lets admins flip them off in two clicks if they don't.
 *
 * The per-matter columns are nullable; null = inherit. The
 * resolver below boils that to a concrete boolean for callers.
 */

import { prisma } from "@/lib/prisma";

export type EffectiveCalendarDefaults = {
  autoAddTeamToNewEvents: boolean;
  autoAddTeamToUpcomingEvents: boolean;
};

/** Resolve effective defaults for a given matter. The caller
 *  passes a matter id; we look up both the matter overrides and
 *  the matter's firm settings in one query. */
export async function getEffectiveCalendarDefaults(
  matterId: string
): Promise<EffectiveCalendarDefaults> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      autoAddTeamToNewEvents: true,
      autoAddTeamToUpcomingEvents: true,
      // Matters don't carry firmId today — the firm comes
      // through MatterTeamMember → User.firmId. For now we read
      // from the first active firm in the system, which is the
      // single-tenant reality. When multi-tenant lands, matter
      // gains its own firmId and this resolver scopes to it.
    },
  });
  if (!matter) {
    // Treat a missing matter as "off" — defensive against
    // accidental triggers downstream.
    return {
      autoAddTeamToNewEvents: false,
      autoAddTeamToUpcomingEvents: false,
    };
  }
  const firm = await prisma.firm.findFirst({
    select: {
      autoAddTeamToNewEvents: true,
      autoAddTeamToUpcomingEvents: true,
    },
  });
  // Firm should always exist in single-tenant mode; defensive
  // fallback to "off" if not.
  const firmDefaults = firm ?? {
    autoAddTeamToNewEvents: false,
    autoAddTeamToUpcomingEvents: false,
  };
  return {
    autoAddTeamToNewEvents:
      matter.autoAddTeamToNewEvents ?? firmDefaults.autoAddTeamToNewEvents,
    autoAddTeamToUpcomingEvents:
      matter.autoAddTeamToUpcomingEvents ??
      firmDefaults.autoAddTeamToUpcomingEvents,
  };
}
