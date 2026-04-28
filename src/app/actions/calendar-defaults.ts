/**
 * Calendar-defaults server actions.
 *
 * Two scopes:
 *   - Firm-wide (Firm.autoAddTeamToNewEvents +
 *     autoAddTeamToUpcomingEvents) — gated on `firm.edit_info`.
 *   - Per-matter override (Matter.autoAddTeamToNewEvents +
 *     autoAddTeamToUpcomingEvents) — gated on `matters.edit`.
 *
 * Per-matter values are tri-state from the UI: "true", "false",
 * or "inherit" (which writes null on the matter so the resolver
 * falls back to the firm setting). The form posts the three
 * values as plain strings; this layer parses + persists.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";

const firmSchema = z.object({
  autoAddTeamToNewEvents: z.literal("on").optional(),
  autoAddTeamToUpcomingEvents: z.literal("on").optional(),
});

export async function updateFirmCalendarDefaults(
  _prev: { status: "idle" | "ok" | "error"; error?: string },
  formData: FormData
): Promise<{ status: "idle" | "ok" | "error"; error?: string }> {
  await requirePermission("firm.edit_info");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = firmSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", error: "Invalid input." };
  }
  const firm = await getCurrentFirm();
  await prisma.firm.update({
    where: { id: firm.id },
    data: {
      autoAddTeamToNewEvents: parsed.data.autoAddTeamToNewEvents === "on",
      autoAddTeamToUpcomingEvents:
        parsed.data.autoAddTeamToUpcomingEvents === "on",
    },
  });
  // Calendar defaults touch the matter edit pages + every event-
  // create + team-add. Layout revalidation is the cheapest sweep.
  revalidatePath("/", "layout");
  return { status: "ok" };
}

const triStateSchema = z.enum(["inherit", "true", "false"]);

const matterSchema = z.object({
  autoAddTeamToNewEvents: triStateSchema.default("inherit"),
  autoAddTeamToUpcomingEvents: triStateSchema.default("inherit"),
});

const triToBool = (v: "inherit" | "true" | "false"): boolean | null =>
  v === "inherit" ? null : v === "true";

export async function updateMatterCalendarDefaults(
  matterId: string,
  _prev: { status: "idle" | "ok" | "error"; error?: string },
  formData: FormData
): Promise<{ status: "idle" | "ok" | "error"; error?: string }> {
  await requirePermission("matters.edit");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = matterSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", error: "Invalid input." };
  }
  await prisma.matter.update({
    where: { id: matterId },
    data: {
      autoAddTeamToNewEvents: triToBool(parsed.data.autoAddTeamToNewEvents),
      autoAddTeamToUpcomingEvents: triToBool(
        parsed.data.autoAddTeamToUpcomingEvents
      ),
    },
  });
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  return { status: "ok" };
}
