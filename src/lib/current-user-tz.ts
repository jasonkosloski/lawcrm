/**
 * Server-only resolver for the current user's IANA time zone.
 *
 * Lives in its own file (not alongside the pure formatters in
 * `format-date.ts`) because Turbopack is eager about tracing
 * imports — even a dynamic `await import("@/lib/prisma")` inside
 * an async function gets pulled into any client bundle that
 * touches the surrounding module. Calendar surfaces that go
 * client-side (WeekView for the optimistic drag-drop) need the
 * pure formatters from `format-date.ts` without dragging the
 * Prisma client + `pg` driver into the browser bundle.
 */

import "server-only";

import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export const DEFAULT_TIME_ZONE = "America/Denver";

/**
 * Cached per request — layouts, pages and actions each ask for it.
 *
 * `getCurrentUserId()` stays OUTSIDE the try: with no session it throws
 * Next's redirect to /login, and swallowing that would let a signed-out
 * request carry on rendering with the default zone. The catch also
 * re-throws Next control-flow errors (`unstable_rethrow`); only a
 * genuine lookup failure falls back to the default zone, and it is
 * logged so a silently-wrong zone is at least visible in server logs.
 */
export const getCurrentUserTimeZone = cache(async (): Promise<string> => {
  const userId = await getCurrentUserId();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });
    return user?.timeZone ?? DEFAULT_TIME_ZONE;
  } catch (err) {
    unstable_rethrow(err);
    console.error("[current-user-tz] zone lookup failed; using default", err);
    return DEFAULT_TIME_ZONE;
  }
});
