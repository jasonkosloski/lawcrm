/**
 * Conflict-check server actions.
 *
 *   - runLeadConflictCheck(leadId): re-scans the lead's identity
 *     fingerprint against the firm's data and persists the result
 *     to Lead.conflictCheck + .conflictCheckedAt. Permission:
 *     intake.conflict_check.run.
 *   - overrideLeadConflictCheck(leadId, formData): authorized
 *     override — flips a flagged/conflicted lead to "override"
 *     status with a required justification (ethics audit trail).
 *     Permission: intake.conflict_check.override.
 *
 * Both actions write to ActivityLog so the matter-level audit
 * captures who-did-what for compliance review.
 *
 * The matcher itself (`runConflictMatcher`) is pure and lives in
 * `src/lib/conflict-check.ts` so the lead detail page can render
 * live matches on every load without going through this action.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import { requirePermission } from "@/lib/permission-check";
import { runConflictMatcher } from "@/lib/conflict-check";

export async function runLeadConflictCheck(
  leadId: string
): Promise<{ ok: boolean; error?: string; severity?: string }> {
  await requirePermission("intake.conflict_check.run");
  const actorId = await getCurrentUserId();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      conflictCheck: true,
      // Pull the joined Contact's identity fields when available,
      // falling back to the legacy free-text columns on Lead.
      contact: { select: { name: true, email: true, organization: true } },
      name: true,
      email: true,
    },
  });
  if (!lead) return { ok: false, error: "Lead not found." };

  const result = await runConflictMatcher({
    name: lead.contact?.name ?? lead.name,
    email: lead.contact?.email ?? lead.email,
    organization: lead.contact?.organization ?? null,
  });

  // Don't clobber an existing manual override. If the user
  // previously cleared this lead despite a flag, re-running the
  // matcher shouldn't silently revert that decision; surface the
  // re-run result without changing status.
  const newStatus =
    lead.conflictCheck === "override" ? "override" : result.severity;

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      conflictCheck: newStatus,
      conflictCheckedAt: new Date(),
    },
  });

  // matterId: null because the lead may not have a matter yet.
  // Activity log is firm-scope here.
  await logActivity({
    matterId: null,
    userId: actorId,
    type: "filing",
    title: `Conflict check run on lead — ${result.severity}`,
    detail:
      result.matches.length > 0
        ? `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`
        : "No matches",
  });

  revalidatePath(`/intake/${leadId}`);
  return { ok: true, severity: result.severity };
}

const overrideSchema = z.object({
  /** Free-text justification — required for ethics-audit
   *  defensibility. "Informed-consent waiver signed", "former
   *  client, no substantial relationship," etc. */
  notes: z
    .string()
    .trim()
    .min(5, "Justification is required (5+ characters).")
    .max(2000),
});

export async function overrideLeadConflictCheck(
  leadId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("intake.conflict_check.override");
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.flatten().fieldErrors.notes?.[0] ??
        "Invalid justification.",
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, conflictCheck: true },
  });
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.conflictCheck !== "warn" && lead.conflictCheck !== "conflict") {
    return {
      ok: false,
      error:
        "Override only applies to flagged or conflicted leads. Run the conflict check first.",
    };
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      conflictCheck: "override",
      conflictResolutionNotes: parsed.data.notes,
    },
  });

  await logActivity({
    matterId: null,
    userId: actorId,
    type: "filing",
    title: `Conflict check overridden on lead`,
    detail: parsed.data.notes,
  });

  revalidatePath(`/intake/${leadId}`);
  return { ok: true };
}
