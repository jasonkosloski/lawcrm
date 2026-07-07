/**
 * Timer widget queries.
 *
 * `getCurrentTimerSession` feeds the floating timer widget mounted
 * in the AppShell — one findUnique per page render (TimerSession is
 * one-per-user via the userId unique). Null-safe on the session so
 * a stale/unauthenticated render never throws from inside the
 * layout tree.
 *
 * `getTimerMatterOptions` is the compact matter list for the
 * stop-timer composer's REQUIRED matter picker. Only fetched when a
 * timer session actually exists (see AppShell) so the idle state
 * adds zero per-page query cost.
 */

import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type ActiveTimerSession = {
  id: string;
  matterId: string | null;
  matterName: string | null;
  activity: string | null;
  /** ISO string, not Date — crosses the RSC boundary into the client
   *  widget which computes elapsed from it on every tick. */
  startedAt: string;
};

export const getCurrentTimerSession = cache(
  async (): Promise<ActiveTimerSession | null> => {
    const session = await auth();
    if (!session?.user?.id) return null;
    const t = await prisma.timerSession.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        matterId: true,
        activity: true,
        startedAt: true,
        matter: { select: { name: true } },
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      matterId: t.matterId,
      matterName: t.matter?.name ?? null,
      activity: t.activity,
      startedAt: t.startedAt.toISOString(),
    };
  }
);

export type TimerMatterOption = { id: string; name: string };

/** Active (non-archived) matters, name-ordered, id + name only —
 *  keeps the widget payload small even for a large book of cases. */
export async function getTimerMatterOptions(): Promise<TimerMatterOption[]> {
  return prisma.matter.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
