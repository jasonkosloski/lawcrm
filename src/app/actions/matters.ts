/**
 * Matter server actions.
 *
 * Writes that create or mutate `Matter` rows. Practice area + stage
 * come in as FK ids (not names) since the options are pulled from the
 * database by the forms above; each action verifies the ids exist, the
 * stage belongs to the selected area, and (for update) the proposed
 * stage is reachable from the matter's current area.
 */

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
  type UpdateMatterState,
} from "@/lib/new-matter-constants";

const createMatterSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(200, "Name is too long"),
    practiceAreaId: z.string().trim().min(1, "Practice area is required"),
    stageId: z.string().trim().min(1, "Stage is required"),
    feeStructure: z
      .enum(["contingent", "hourly", "flat", "hybrid", "pro_bono"])
      .default("contingent"),
    caseNumber: z.string().trim().max(80).optional().or(z.literal("")),
    court: z.string().trim().max(200).optional().or(z.literal("")),
    clientId: z.string().trim().optional().or(z.literal("")),
    /** When clientId === NEW_CLIENT_SENTINEL, these fields get used to
     *  create a new Contact inline before the Matter is written. */
    newClientName: z.string().trim().max(200).optional().or(z.literal("")),
    newClientEmail: z.string().trim().max(200).optional().or(z.literal("")),
    newClientPhone: z.string().trim().max(80).optional().or(z.literal("")),
    newClientOrganization: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    opposingParty: z.string().trim().max(200).optional().or(z.literal("")),
    opposingFirm: z.string().trim().max(200).optional().or(z.literal("")),
    leadUserId: z.string().trim().min(1, "Lead attorney is required"),
    description: z.string().trim().max(4000).optional().or(z.literal("")),
    pinForMe: z.literal("on").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.clientId === NEW_CLIENT_SENTINEL) {
      if (!data.newClientName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientName"],
          message: "Name is required for a new client",
        });
      }
      if (!data.newClientEmail && !data.newClientPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientEmail"],
          message: "Add an email or phone so the client is reachable",
        });
      }
      if (data.newClientEmail && !data.newClientEmail.includes("@")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newClientEmail"],
          message: "That doesn't look like an email address",
        });
      }
    }
  });

/**
 * Verify the stage belongs to the area. If not, return the first
 * active stage for the area as a safe fallback. Also returns the area
 * color so the caller can snapshot it onto the matter row.
 */
async function resolveAreaAndStage(
  practiceAreaId: string,
  stageId: string
): Promise<
  | { ok: true; practiceAreaId: string; stageId: string; color: string }
  | { ok: false; error: string }
> {
  const area = await prisma.practiceArea.findUnique({
    where: { id: practiceAreaId },
    select: {
      id: true,
      color: true,
      isActive: true,
      stages: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true },
      },
    },
  });
  if (!area || !area.isActive) {
    return { ok: false, error: "Practice area is not available" };
  }
  const stageMatch = area.stages.find((s) => s.id === stageId);
  const resolvedStageId = stageMatch?.id ?? area.stages[0]?.id;
  if (!resolvedStageId) {
    return { ok: false, error: "This practice area has no active stages" };
  }
  return {
    ok: true,
    practiceAreaId: area.id,
    stageId: resolvedStageId,
    color: area.color,
  };
}

export async function createMatter(
  _prev: CreateMatterState,
  formData: FormData
): Promise<CreateMatterState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = createMatterSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const data = parsed.data;

  const resolved = await resolveAreaAndStage(data.practiceAreaId, data.stageId);
  if (!resolved.ok) {
    return {
      status: "error",
      errors: { practiceAreaId: [resolved.error] },
      values: raw,
    };
  }

  const currentUserId = await getCurrentUserId();

  // Verify the selected lead is a real user; fall through to the
  // current user if the posted value is stale.
  const lead = await prisma.user.findUnique({
    where: { id: data.leadUserId },
    select: { id: true },
  });
  const leadUserId = lead?.id ?? currentUserId;

  // Resolve client: either pick an existing Contact, create a new one
  // inline, or leave null.
  let clientId: string | null = null;
  if (data.clientId === NEW_CLIENT_SENTINEL) {
    const newClient = await prisma.contact.create({
      data: {
        name: data.newClientName!,
        email: data.newClientEmail || null,
        phone: data.newClientPhone || null,
        organization: data.newClientOrganization || null,
        type: "client",
      },
      select: { id: true },
    });
    clientId = newClient.id;
  } else if (data.clientId) {
    const client = await prisma.contact.findUnique({
      where: { id: data.clientId },
      select: { id: true },
    });
    clientId = client?.id ?? null;
  }

  const matter = await prisma.matter.create({
    data: {
      name: data.name,
      practiceAreaId: resolved.practiceAreaId,
      stageId: resolved.stageId,
      feeStructure: data.feeStructure,
      caseNumber: data.caseNumber || null,
      court: data.court || null,
      opposingParty: data.opposingParty || null,
      opposingFirm: data.opposingFirm || null,
      description: data.description || null,
      color: resolved.color,
      clientId,
      teamMembers: {
        create: { userId: leadUserId, role: "lead" },
      },
      // Invariant: whenever a matter has a client, that contact
      // surfaces as a MatterContact with category="client" so the
      // Parties tab always shows them. Additional co-clients can
      // still be added manually from the tab.
      ...(clientId
        ? {
            contacts: {
              create: { contactId: clientId, category: "client" },
            },
          }
        : {}),
      ...(data.pinForMe === "on"
        ? {
            pins: {
              create: { userId: currentUserId },
            },
          }
        : {}),
    },
  });

  // Sidebar + matters list both read fresh data on next render.
  revalidatePath("/", "layout");
  redirect(`/matters/${matter.id}`);
}

// ── Update ──────────────────────────────────────────────────────────────

const updateMatterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long"),
  practiceAreaId: z.string().trim().min(1, "Practice area is required"),
  stageId: z.string().trim().min(1, "Stage is required"),
  feeStructure: z.enum([
    "contingent",
    "hourly",
    "flat",
    "hybrid",
    "pro_bono",
  ]),
  caseNumber: z.string().trim().max(80).optional().or(z.literal("")),
  court: z.string().trim().max(200).optional().or(z.literal("")),
  clientId: z.string().trim().optional().or(z.literal("")),
  opposingParty: z.string().trim().max(200).optional().or(z.literal("")),
  opposingFirm: z.string().trim().max(200).optional().or(z.literal("")),
  leadUserId: z.string().trim().min(1, "Lead attorney is required"),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
});

/**
 * Update an existing matter. Bound via `.bind(null, matterId)` at the
 * call site so the form component signature stays `(prev, formData)`.
 *
 * TODO (auth): once we have sessions + role-based access, gate this
 * action to partners, the matter's lead, or an admin role. For now
 * every user can edit every matter.
 */
export async function updateMatter(
  matterId: string,
  _prev: UpdateMatterState,
  formData: FormData
): Promise<UpdateMatterState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateMatterSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const data = parsed.data;

  const resolved = await resolveAreaAndStage(data.practiceAreaId, data.stageId);
  if (!resolved.ok) {
    return {
      status: "error",
      errors: { practiceAreaId: [resolved.error] },
      values: raw,
    };
  }

  // Verify lead + client IDs before writing so stale dropdown values
  // don't point the matter at missing rows.
  const currentUserId = await getCurrentUserId();
  const lead = await prisma.user.findUnique({
    where: { id: data.leadUserId },
    select: { id: true },
  });
  const leadUserId = lead?.id ?? currentUserId;

  let clientId: string | null = null;
  if (data.clientId) {
    const client = await prisma.contact.findUnique({
      where: { id: data.clientId },
      select: { id: true },
    });
    clientId = client?.id ?? null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.matter.update({
      where: { id: matterId },
      data: {
        name: data.name,
        practiceAreaId: resolved.practiceAreaId,
        stageId: resolved.stageId,
        feeStructure: data.feeStructure,
        caseNumber: data.caseNumber || null,
        court: data.court || null,
        opposingParty: data.opposingParty || null,
        opposingFirm: data.opposingFirm || null,
        description: data.description || null,
        color: resolved.color,
        clientId,
      },
    });

    // Sync lead: remove the existing lead team member (if any) and
    // add/replace with the new one. Non-lead team assignments stay
    // untouched — this action only manages the lead slot.
    const existingLead = await tx.matterTeamMember.findFirst({
      where: { matterId, role: "lead" },
      select: { id: true, userId: true },
    });
    if (existingLead && existingLead.userId !== leadUserId) {
      await tx.matterTeamMember.delete({ where: { id: existingLead.id } });
    }
    if (!existingLead || existingLead.userId !== leadUserId) {
      await tx.matterTeamMember.upsert({
        where: {
          matterId_userId: { matterId, userId: leadUserId },
        },
        update: { role: "lead" },
        create: { matterId, userId: leadUserId, role: "lead" },
      });
    }

    // Sync the primary client's MatterContact row. Invariant:
    // whenever Matter.clientId is set, there's a MatterContact with
    // category="client" for that same contact. We upsert on the
    // (matter, contact, category) unique key. We intentionally do
    // NOT auto-remove the prior primary client's row — they may
    // still belong as a co-client on the matter, and removal should
    // be an explicit act via the Parties tab.
    if (clientId) {
      await tx.matterContact.upsert({
        where: {
          matterId_contactId_category: {
            matterId,
            contactId: clientId,
            category: "client",
          },
        },
        create: {
          matterId,
          contactId: clientId,
          category: "client",
        },
        update: {},
      });
    }
  });

  revalidatePath("/", "layout");
  redirect(`/matters/${matterId}`);
}

// ── Stage change ────────────────────────────────────────────────────────

/**
 * Narrow action for the stage control on the matter Overview tab. One
 * SQL update, no redirect — the page revalidates in place and the
 * client-side optimistic UI reconciles with the server value.
 *
 * Validates that the proposed stage belongs to the matter's current
 * practice area; cross-area transitions have to go through the full
 * edit flow (which can also adjust color + other area-scoped state).
 *
 * TODO (auth): once the firm has permissions, gate this to roles the
 * firm administrator has authorized to move stage (e.g. Partner,
 * Managing, or the matter's lead). Today any signed-in user can
 * transition any matter.
 */
export async function updateMatterStage(
  matterId: string,
  newStageId: string
): Promise<{ ok: boolean; error?: string }> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { practiceAreaId: true },
  });
  if (!matter) return { ok: false, error: "Matter not found" };

  const stage = await prisma.matterStage.findUnique({
    where: { id: newStageId },
    select: { id: true, practiceAreaId: true, isActive: true },
  });
  if (!stage || !stage.isActive) {
    return { ok: false, error: "Stage is not available" };
  }
  if (stage.practiceAreaId !== matter.practiceAreaId) {
    return {
      ok: false,
      error: "Stage does not belong to this matter's practice area",
    };
  }

  await prisma.matter.update({
    where: { id: matterId },
    data: { stageId: stage.id },
  });

  // Sidebar practice-area counts exclude terminal stages, and
  // the matters list shows the stage chip — revalidate the whole
  // dashboard tree so both update.
  revalidatePath("/", "layout");
  return { ok: true };
}
