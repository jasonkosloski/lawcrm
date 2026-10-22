/**
 * Timer widget queries.
 *
 * `getCurrentTimerSession` feeds the floating timer widget mounted
 * in the AppShell — one findUnique per page render (TimerSession is
 * one-per-user via the userId unique). Resolves the user through the
 * request-cached `getCurrentUserId`, so it adds no auth() round trip
 * beyond the one the sidebar already pays.
 *
 * `getTimerMatterOptions` is the compact matter list for the
 * stop-timer composer's REQUIRED matter picker. Only fetched when a
 * timer session actually exists (see AppShell) so the idle state
 * adds zero per-page query cost.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { canAccessMatter, matterAccessWhere } from "@/lib/matter-access";

export type ActiveTimerSession = {
  id: string;
  matterId: string | null;
  matterName: string | null;
  /** Only the server query fills this (the /time day view's lane
   *  dot); the widget's optimistic sessions omit it. */
  matterColor?: string | null;
  activity: string | null;
  /** ISO string, not Date — crosses the RSC boundary into the client
   *  widget which computes elapsed from it on every tick. */
  startedAt: string;
};

export const getCurrentTimerSession = cache(async (): Promise<ActiveTimerSession | null> => {
  // The cached resolver, not a bare auth(): every auth() runs the
  // jwt callback's DB lookup, and the shell resolves the user for
  // the sidebar in the same request. (It redirects to /login when
  // signed out, exactly as the sidebar query beside it does.)
  const userId = await getCurrentUserId();
  const t = await prisma.timerSession.findUnique({
    where: { userId },
    select: {
      id: true,
      matterId: true,
      activity: true,
      startedAt: true,
      matter: { select: { name: true, color: true } },
    },
  });
  if (!t) return null;
  // Matter wall: a timer left running on a matter the user can no
  // longer access (removed from the team, wall switched on) shows
  // nothing identifying it - the stop composer asks for a matter.
  const visible = !t.matterId || (await canAccessMatter(userId, t.matterId));
  return {
    id: t.id,
    matterId: visible ? t.matterId : null,
    matterName: visible ? (t.matter?.name ?? null) : null,
    matterColor: visible ? (t.matter?.color ?? null) : null,
    activity: t.activity,
    startedAt: t.startedAt.toISOString(),
  };
});

export type TimerMatterOption = { id: string; name: string };

/** Active (non-archived) matters, name-ordered, id + name only —
 *  keeps the widget payload small even for a large book of cases. */
export async function getTimerMatterOptions(): Promise<TimerMatterOption[]> {
  return prisma.matter.findMany({
    where: {
      ...(await matterAccessWhere(await getCurrentUserId())),
      isArchived: false,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
