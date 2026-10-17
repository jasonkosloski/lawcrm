/**
 * Server actions for per-user matter pinning.
 *
 * Pins are stored in the `UserMatterPin` join table so each user curates
 * their own sidebar. `setMatterPin` is the idempotent primitive the UI
 * uses (the caller states the pin state it wants, so a stale tab or a
 * double click can't flip it the wrong way); `toggleMatterPin` is kept
 * as a thin wrapper. Both revalidate the surfaces that show pin state
 * (sidebar, matter list, matter detail).
 *
 * Pins are private per-user view state, not matter data, so they are
 * not activity-logged.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

/** Set the current user's pin on a matter to exactly `pinned`.
 *  Idempotent and race-safe: pinning upserts on (user, matter) and
 *  unpinning is a deleteMany, so concurrent or repeated calls never
 *  throw a unique/missing-row error. Pinning a matter that doesn't
 *  exist returns an error instead of an FK-violation 500. */
export async function setMatterPin(
  matterId: string,
  pinned: boolean
): Promise<{ ok: boolean; pinned: boolean; error?: string }> {
  const userId = await getCurrentUserId();

  try {
    if (pinned) {
      const matter = await prisma.matter.findUnique({
        where: { id: matterId },
        select: { id: true },
      });
      if (!matter) {
        return { ok: false, pinned: false, error: "Matter not found." };
      }
      await prisma.userMatterPin.upsert({
        where: { userId_matterId: { userId, matterId } },
        create: { userId, matterId },
        update: {},
      });
    } else {
      await prisma.userMatterPin.deleteMany({ where: { userId, matterId } });
    }
  } catch (err) {
    // e.g. the matter was deleted between the check and the write (FK
    // violation). Log the detail, show a generic message.
    console.error("setMatterPin failed", err);
    return {
      ok: false,
      pinned: false,
      error: "Couldn't update the pin. Please try again.",
    };
  }

  // Sidebar lives in the dashboard layout — revalidate the whole tree so
  // the pin list + any pin-aware list views refresh.
  revalidatePath("/", "layout");

  return { ok: true, pinned };
}

/** Flip the pin from whatever the server currently has. Prefer
 *  `setMatterPin` from UI that knows the state it wants. */
export async function toggleMatterPin(
  matterId: string
): Promise<{ pinned: boolean }> {
  const userId = await getCurrentUserId();
  const existing = await prisma.userMatterPin.findUnique({
    where: { userId_matterId: { userId, matterId } },
    select: { userId: true },
  });
  const res = await setMatterPin(matterId, !existing);
  return { pinned: res.pinned };
}
