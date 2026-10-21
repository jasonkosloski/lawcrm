/**
 * Server actions for the current user's email notification settings:
 * the email mode per category (Off / Instant / Daily digest) and the
 * per-matter email mute. The delivery worker
 * (src/lib/notification-email.ts) reads both at send time.
 *
 * Identity-scoped: every write is keyed to the caller, so there is no
 * permission key (like Settings -> Security). These are private
 * per-user view settings, not matter data, so like matter pins they
 * are not activity-logged.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import {
  CATEGORY_BY_TYPE,
  categoryMeta,
  isAllowedMode,
  isNotificationCategory,
} from "@/lib/notification-categories";

const SETTINGS_PATH = "/settings/notifications";

const modeInput = z.object({
  category: z.string().refine(isNotificationCategory),
  mode: z.string(),
});

export async function setNotificationEmailMode(
  category: string,
  mode: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  const parsed = modeInput.safeParse({ category, mode });
  if (!parsed.success || !isNotificationCategory(category)) {
    return { ok: false, error: "Unknown notification category." };
  }
  if (!isAllowedMode(category, mode)) {
    return {
      ok: false,
      error:
        category === "deadlines"
          ? "Deadline reminders can't be turned off."
          : `That isn't a valid email setting for ${categoryMeta(category).label}.`,
    };
  }
  try {
    await prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: { userId, category, emailMode: mode },
      update: { emailMode: mode },
    });
    if (mode !== "digest") {
      // Rows already held for a digest follow the new mode now rather
      // than at the next 07:00: back to the outbox, where the worker
      // re-decides them (Instant sends, Off skips).
      const types = Object.entries(CATEGORY_BY_TYPE)
        .filter(([, c]) => c === category)
        .map(([t]) => t);
      await prisma.notification.updateMany({
        where: { userId, emailState: "held", type: { in: types } },
        data: { emailState: "pending" },
      });
    }
  } catch (err) {
    console.error("setNotificationEmailMode failed", err);
    return { ok: false, error: "Couldn't save the setting. Please try again." };
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** Set the caller's email mute on a matter to exactly `muted`.
 *  Idempotent and race-safe, mirroring `setMatterPin`. Deadline
 *  reminders still arrive for muted matters. */
export async function setMatterEmailMute(
  matterId: string,
  muted: boolean
): Promise<{ ok: boolean; muted: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  // Outside the try: notFound() must not be swallowed by the catch.
  if (muted) await assertMatterAccess(matterId);

  try {
    if (muted) {
      // ON CONFLICT DO NOTHING: atomic under concurrent clicks.
      await prisma.notificationMatterMute.createMany({
        data: [{ userId, matterId }],
        skipDuplicates: true,
      });
    } else {
      await prisma.notificationMatterMute.deleteMany({ where: { userId, matterId } });
    }
  } catch (err) {
    console.error("setMatterEmailMute failed", err);
    return {
      ok: false,
      muted: !muted,
      error: "Couldn't update email notifications. Please try again.",
    };
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath(`/matters/${matterId}`, "layout");
  return { ok: true, muted };
}
