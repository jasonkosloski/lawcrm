"use server";

/**
 * Restricted intake (lead ethical walls, ADR-049): mark a lead
 * restricted and manage who may see it. Gated by `intake.restrict`;
 * every action also asserts the actor can see the lead (a non-member
 * gets the same 404 as a missing lead). Logged firm-scope with
 * `leadId` so the feed itself respects the wall.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { assertLeadAccess } from "@/lib/lead-access";
import { logActivity } from "@/lib/activity-log";
import { MATTER_TEAM_ROLES, matterTeamRoleLabel } from "@/lib/matter-team-constants";

type Result = { ok: boolean; error?: string };

const LAST_MEMBER_ERROR = "A restricted intake needs at least one team member.";

function revalidateLeadAccess(leadId: string) {
  revalidatePath("/intake");
  revalidatePath(`/intake/${leadId}`, "layout");
  // Sidebar open-leads badge + Cmd+K.
  revalidatePath("/", "layout");
}

/** Row lock so concurrent restrict / remove calls can't both pass the
 *  "at least one member" check. */
async function lockLead(tx: Pick<typeof prisma, "$queryRaw">, leadId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "leads" WHERE id = ${leadId} FOR UPDATE`;
}

export async function setLeadRestricted(leadId: string, restricted: boolean): Promise<Result> {
  const actorId = await requirePermission("intake.restrict");
  await assertLeadAccess(leadId);

  const changed = await prisma.$transaction(async (tx) => {
    await lockLead(tx, leadId);
    const lead = await tx.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { restricted: true },
    });
    if (restricted) {
      // The actor always keeps access to what they just walled off.
      await tx.leadTeamMember.upsert({
        where: { leadId_userId: { leadId, userId: actorId } },
        create: { leadId, userId: actorId, addedBy: actorId },
        update: {},
      });
    }
    if (lead.restricted === restricted) return false;
    await tx.lead.update({ where: { id: leadId }, data: { restricted } });
    return true;
  });

  if (changed) {
    await logActivity({
      matterId: null,
      leadId,
      userId: actorId,
      type: "filing",
      title: restricted ? "Intake restricted to its team" : "Intake opened to the firm",
    });
  }
  revalidateLeadAccess(leadId);
  return { ok: true };
}

const addSchema = z.object({
  userId: z.string().trim().min(1, "Pick a user"),
  role: z.enum(MATTER_TEAM_ROLES),
});

export async function addLeadTeamMember(leadId: string, formData: FormData): Promise<Result> {
  const actorId = await requirePermission("intake.restrict");
  await assertLeadAccess(leadId);

  const parsed = addSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return { ok: false, error: flat.userId?.[0] ?? flat.role?.[0] ?? "Invalid input." };
  }
  const { userId, role } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, error: "User not found or deactivated." };
  }

  await prisma.leadTeamMember.upsert({
    where: { leadId_userId: { leadId, userId } },
    create: { leadId, userId, role, addedBy: actorId },
    update: { role },
  });
  await logActivity({
    matterId: null,
    leadId,
    userId: actorId,
    type: "filing",
    title: `${user.name} added to the intake team as ${matterTeamRoleLabel(role)}`,
  });
  revalidateLeadAccess(leadId);
  return { ok: true };
}

export async function removeLeadTeamMember(leadId: string, userId: string): Promise<Result> {
  const actorId = await requirePermission("intake.restrict");
  await assertLeadAccess(leadId);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockLead(tx, leadId);
    const [lead, count, row] = await Promise.all([
      tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { restricted: true } }),
      tx.leadTeamMember.count({ where: { leadId } }),
      tx.leadTeamMember.findUnique({
        where: { leadId_userId: { leadId, userId } },
        select: { user: { select: { name: true } } },
      }),
    ]);
    if (!row) return { kind: "missing" as const };
    if (lead.restricted && count <= 1) return { kind: "last" as const };
    await tx.leadTeamMember.delete({
      where: { leadId_userId: { leadId, userId } },
    });
    return { kind: "removed" as const, name: row.user.name };
  });

  if (outcome.kind === "last") return { ok: false, error: LAST_MEMBER_ERROR };
  if (outcome.kind === "missing") return { ok: true };
  await logActivity({
    matterId: null,
    leadId,
    userId: actorId,
    type: "filing",
    title: `${outcome.name} removed from the intake team`,
  });
  revalidateLeadAccess(leadId);
  return { ok: true };
}
