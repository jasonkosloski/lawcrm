/**
 * Server actions for per-user matter pinning.
 *
 * Pins are stored in the `UserMatterPin` join table so each user curates
 * their own sidebar. `toggleMatterPin` flips the pin state for the current
 * user and revalidates the surfaces that show pin state (sidebar, matter
 * list, matter detail).
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export async function toggleMatterPin(matterId: string): Promise<{ pinned: boolean }> {
  const userId = await getCurrentUserId();

  const existing = await prisma.userMatterPin.findUnique({
    where: { userId_matterId: { userId, matterId } },
    select: { userId: true },
  });

  if (existing) {
    await prisma.userMatterPin.delete({
      where: { userId_matterId: { userId, matterId } },
    });
  } else {
    await prisma.userMatterPin.create({ data: { userId, matterId } });
  }

  // Sidebar lives in the dashboard layout — revalidate the whole tree so
  // the pin list + any pin-aware list views refresh.
  revalidatePath("/", "layout");

  return { pinned: !existing };
}
