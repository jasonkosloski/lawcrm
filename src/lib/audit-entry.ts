/**
 * Fire-and-forget audit entry for mutations whose `type` is not one of
 * the matter-timeline `ActivityType`s (party edits, practice-area /
 * stage settings, contact edits). Same contract as `logActivity`: a
 * failed audit write must never roll back the user's action. Rows
 * land in ActivityLog, so they show on the matter Timeline (when
 * `matterId` is set) and under Settings -> Activity ("All").
 *
 * Callers pass field NAMES (and non-PII old/new values for settings),
 * never client contact values, so the audit trail does not become a
 * second copy of the PII.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function logAuditEntry(input: {
  matterId: string | null;
  userId: string;
  type: string;
  source: string;
  title: string;
  detail?: string | null;
  icon?: string;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        matterId: input.matterId,
        userId: input.userId,
        type: input.type,
        icon: input.icon ?? "zap",
        source: input.source,
        title: input.title,
        detail: input.detail ?? null,
      },
    });
    revalidatePath("/");
  } catch (err) {
    console.warn("[audit] failed to write activity entry", err);
  }
}

/** Firm-level audit row for a Settings change. `changes` entries that
 *  are null (nothing changed) are dropped and the rest joined into the
 *  detail; with `skipIfNoChanges`, nothing changed means no row. */
export async function logSettingsChange(
  userId: string,
  title: string,
  changes: Array<string | null> = [],
  skipIfNoChanges = false
): Promise<void> {
  const list = changes.filter((c): c is string => c !== null);
  if (list.length === 0 && skipIfNoChanges) return;
  await logAuditEntry({
    matterId: null,
    userId,
    type: "settings",
    source: "Settings",
    title,
    detail: list.length > 0 ? list.join("; ") : null,
  });
}
