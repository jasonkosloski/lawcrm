/**
 * Staff actions for the client portal "case status" feature.
 *
 * Every action gates on its permission, then asserts matter access
 * (ADR-039) outside any try/catch so a walled user gets Next's
 * not-found.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermissionResult } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { statusUpdateEmail } from "@/lib/portal/emails";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { emailLivePortalUsers } from "@/lib/portal/notify-clients";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

const NOT_FOUND = "Update not found.";

function done(matterId: string, warning?: string): Result {
  revalidatePath(`/matters/${matterId}`);
  return warning ? { ok: true, warning } : { ok: true };
}

// ---------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------

const updateSchema = z.object({
  stageLabel: z
    .string()
    .trim()
    .min(1, "Enter a stage label.")
    .max(60, "That stage label is too long (60 characters max)."),
  body: z
    .string()
    .trim()
    .min(1, "Enter an update.")
    .max(4000, "That update is too long (4,000 characters max)."),
});

function parseUpdate(
  input: unknown
): { ok: true; stageLabel: string; body: string } | { ok: false; error: string } {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid update." };
  }
  return { ok: true, ...parsed.data };
}

export async function postStatusUpdate(
  matterId: string,
  input: { stageLabel: string; body: string; emailClient: boolean }
): Promise<Result> {
  const gate = await requirePermissionResult("portal.add_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  await assertMatterAccess(matterId);

  const parsed = parseUpdate(input);
  if (!parsed.ok) return parsed;

  const row = await prisma.portalStatusUpdate.create({
    data: {
      matterId,
      stageLabel: parsed.stageLabel,
      body: parsed.body,
      postedById: gate.userId,
    },
    select: { id: true },
  });

  let emailFailed = false;
  if (input.emailClient) {
    try {
      const res = await emailLivePortalUsers(matterId, statusUpdateEmail(portalHomeUrl()));
      if (res.sent > 0) {
        await prisma.portalStatusUpdate.update({
          where: { id: row.id },
          data: { emailedAt: new Date() },
        });
      }
      emailFailed = res.failed > 0;
    } catch (err) {
      console.warn("[portal-status] update email failed", err);
      emailFailed = true;
    }
  }

  await logActivity({
    matterId,
    userId: gate.userId,
    type: "note",
    title: `Posted client status update: ${parsed.stageLabel}`,
    detail: emailFailed ? "— email failed" : null,
  });
  return done(matterId, emailFailed ? "Update posted, but the email didn't send." : undefined);
}

async function loadUpdate(id: string) {
  return prisma.portalStatusUpdate.findUnique({
    where: { id },
    select: { id: true, matterId: true },
  });
}

/** Edits never re-send the email. */
export async function editStatusUpdate(
  id: string,
  input: { stageLabel: string; body: string }
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await loadUpdate(id);
  if (!row) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(row.matterId);

  const parsed = parseUpdate(input);
  if (!parsed.ok) return parsed;

  await prisma.portalStatusUpdate.update({
    where: { id },
    data: { stageLabel: parsed.stageLabel, body: parsed.body, editedAt: new Date() },
  });
  await logActivity({
    matterId: row.matterId,
    userId: gate.userId,
    type: "note",
    title: "Edited client status update",
  });
  return done(row.matterId);
}

export async function deleteStatusUpdate(id: string): Promise<Result> {
  const gate = await requirePermissionResult("portal.delete_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await loadUpdate(id);
  if (!row) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(row.matterId);

  await prisma.portalStatusUpdate.delete({ where: { id } });
  await logActivity({
    matterId: row.matterId,
    userId: gate.userId,
    type: "note",
    title: "Deleted client status update",
  });
  return done(row.matterId);
}
