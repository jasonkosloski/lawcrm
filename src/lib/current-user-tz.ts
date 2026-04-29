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

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export async function getCurrentUserTimeZone(): Promise<string> {
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });
    return user?.timeZone ?? "America/Denver";
  } catch {
    return "America/Denver";
  }
}
