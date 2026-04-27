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
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requireAdmin } from "@/lib/firm";
import { logActivity } from "@/lib/activity-log";
import { BILLING_MODES } from "@/lib/billing-mode-constants";
import {
  MATTER_TEAM_ROLES,
  matterTeamRoleLabel,
} from "@/lib/matter-team-constants";
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
    /** SOL fields — ignored unless the selected practice area has
     *  hasStatuteOfLimitations=true. Form shows them conditionally. */
    statuteOfLimitationsDate: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    statuteOfLimitationsNotes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .or(z.literal("")),
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

/** Signature we use to identify the one auto-managed SOL deadline
 *  per matter. Manually-created deadlines (kind="critical" via the
 *  Deadlines tab composer) don't set this `sourceType`, so we can
 *  find-and-update cleanly without clobbering unrelated rows. */
const SOL_SOURCE_TYPE = "statute_of_limitations";

/** Keeps the auto-managed "Statute of limitations" Deadline row in
 *  sync with the matter's SOL fields. Called from create + update +
 *  setMatterSolSatisfied so all three paths maintain the invariant:
 *
 *  - SOL date present → a critical Deadline exists with that dueDate
 *  - SOL cleared / area no longer tracks SOL → deadline is removed
 *  - satisfied=true → deadline status flipped to "completed"
 *  - satisfied=false → deadline flipped back to "open"
 */
async function syncMatterSolDeadline(
  tx: Prisma.TransactionClient | typeof prisma,
  opts: {
    matterId: string;
    trackSol: boolean;
    date: Date | null;
    notes: string | null;
    satisfied: boolean;
    satisfiedAt: Date | null;
    ownerId: string | null;
  }
): Promise<void> {
  const existing = await tx.deadline.findFirst({
    where: { matterId: opts.matterId, sourceType: SOL_SOURCE_TYPE },
    select: { id: true },
  });

  // Tracking is off or no date set — remove the auto row entirely so
  // the Deadlines tab doesn't show a dangling SOL entry.
  if (!opts.trackSol || !opts.date) {
    if (existing) {
      await tx.deadline.delete({ where: { id: existing.id } });
    }
    return;
  }

  const data = {
    title: "Statute of limitations",
    dueDate: opts.date,
    kind: "critical" as const,
    sourceType: SOL_SOURCE_TYPE,
    description: opts.notes,
    ownerId: opts.ownerId,
    status: opts.satisfied ? "completed" : "open",
    completedAt: opts.satisfied ? opts.satisfiedAt : null,
  };
  if (existing) {
    await tx.deadline.update({ where: { id: existing.id }, data });
  } else {
    await tx.deadline.create({
      data: { matterId: opts.matterId, ...data },
    });
  }
}

/**
 * Verify the stage belongs to the area. If not, return the first
 * active stage for the area as a safe fallback. Also returns the area
 * color so the caller can snapshot it onto the matter row.
 */
async function resolveAreaAndStage(
  practiceAreaId: string,
  stageId: string
): Promise<
  | {
      ok: true;
      practiceAreaId: string;
      stageId: string;
      color: string;
      hasStatuteOfLimitations: boolean;
      /** Snapshotted onto the new Matter so per-area changes don't
       *  rewrite history. Per-matter override happens via the matter
       *  edit form. */
      defaultBillingMode: string;
    }
  | { ok: false; error: string }
> {
  const area = await prisma.practiceArea.findUnique({
    where: { id: practiceAreaId },
    select: {
      id: true,
      color: true,
      isActive: true,
      hasStatuteOfLimitations: true,
      defaultBillingMode: true,
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
    hasStatuteOfLimitations: area.hasStatuteOfLimitations,
    defaultBillingMode: area.defaultBillingMode,
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
    // Seed a first-class primary ContactPhone row so the contact
    // starts with a real phone record the Parties edit form can
    // manage. Denormalized Contact.phone above keeps old readers happy.
    if (data.newClientPhone) {
      await prisma.contactPhone.create({
        data: {
          contactId: clientId,
          label: "Primary",
          number: data.newClientPhone,
          isPrimary: true,
          order: 0,
        },
      });
    }
  } else if (data.clientId) {
    const client = await prisma.contact.findUnique({
      where: { id: data.clientId },
      select: { id: true },
    });
    clientId = client?.id ?? null;
  }

  // Only persist SOL fields when the area actually tracks them;
  // otherwise drop them on the floor so a stale form submission from
  // an area that used to track SOL doesn't leave dangling dates.
  const solDate =
    resolved.hasStatuteOfLimitations && data.statuteOfLimitationsDate
      ? new Date(data.statuteOfLimitationsDate)
      : null;
  const solNotes =
    resolved.hasStatuteOfLimitations
      ? data.statuteOfLimitationsNotes || null
      : null;

  const matter = await prisma.matter.create({
    data: {
      name: data.name,
      practiceAreaId: resolved.practiceAreaId,
      stageId: resolved.stageId,
      feeStructure: data.feeStructure,
      // Snapshot the area's defaultBillingMode onto the matter on
      // create. Per-area changes don't rewrite history; per-matter
      // override happens on the matter edit form.
      billingMode: resolved.defaultBillingMode,
      caseNumber: data.caseNumber || null,
      court: data.court || null,
      opposingParty: data.opposingParty || null,
      opposingFirm: data.opposingFirm || null,
      description: data.description || null,
      color: resolved.color,
      clientId,
      statuteOfLimitationsDate: solDate,
      statuteOfLimitationsNotes: solNotes,
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

  // Auto-create the critical SOL Deadline when the area tracks SOL
  // and a date was provided. Kept in sync via updateMatter +
  // setMatterSolSatisfied below.
  await syncMatterSolDeadline(prisma, {
    matterId: matter.id,
    trackSol: resolved.hasStatuteOfLimitations,
    date: solDate,
    notes: solNotes,
    satisfied: false,
    satisfiedAt: null,
    ownerId: leadUserId,
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
  /** Per-matter override of the practice area's defaultBillingMode.
   *  Optional on the form so older clients without the field don't
   *  reject; we just leave the existing value alone. */
  billingMode: z.enum(BILLING_MODES).optional(),
  caseNumber: z.string().trim().max(80).optional().or(z.literal("")),
  court: z.string().trim().max(200).optional().or(z.literal("")),
  clientId: z.string().trim().optional().or(z.literal("")),
  opposingParty: z.string().trim().max(200).optional().or(z.literal("")),
  opposingFirm: z.string().trim().max(200).optional().or(z.literal("")),
  leadUserId: z.string().trim().min(1, "Lead attorney is required"),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  statuteOfLimitationsDate: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  statuteOfLimitationsNotes: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .or(z.literal("")),
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

  // Same SOL guard as createMatter — if the new area doesn't track
  // SOL, null out any date/notes so switching areas doesn't leave
  // orphaned SOL data.
  const solDate =
    resolved.hasStatuteOfLimitations && data.statuteOfLimitationsDate
      ? new Date(data.statuteOfLimitationsDate)
      : null;
  const solNotes =
    resolved.hasStatuteOfLimitations
      ? data.statuteOfLimitationsNotes || null
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.matter.update({
      where: { id: matterId },
      data: {
        name: data.name,
        practiceAreaId: resolved.practiceAreaId,
        stageId: resolved.stageId,
        feeStructure: data.feeStructure,
        // Only write when the form posted a value — keeps forward-
        // compat with older clients that don't include the field.
        ...(data.billingMode ? { billingMode: data.billingMode } : {}),
        caseNumber: data.caseNumber || null,
        court: data.court || null,
        opposingParty: data.opposingParty || null,
        opposingFirm: data.opposingFirm || null,
        description: data.description || null,
        color: resolved.color,
        clientId,
        statuteOfLimitationsDate: solDate,
        statuteOfLimitationsNotes: solNotes,
        // If the area dropped SOL tracking, clear the satisfied flag
        // as well so we don't carry stale state.
        ...(resolved.hasStatuteOfLimitations
          ? {}
          : {
              statuteOfLimitationsSatisfied: false,
              statuteOfLimitationsSatisfiedAt: null,
            }),
      },
    });

    // Sync lead. Match addMatterTeamMember's promotion shape: any
    // existing active lead that isn't the new pick gets demoted
    // to co_counsel (humane swap, not an off-team kick), and the
    // new lead is upserted — restoring a former-member row if
    // they previously left the team.
    const existingLead = await tx.matterTeamMember.findFirst({
      where: { matterId, role: "lead", removedAt: null },
      select: { id: true, userId: true },
    });
    if (existingLead && existingLead.userId !== leadUserId) {
      await tx.matterTeamMember.update({
        where: { id: existingLead.id },
        data: { role: "co_counsel" },
      });
    }
    if (!existingLead || existingLead.userId !== leadUserId) {
      await tx.matterTeamMember.upsert({
        where: {
          matterId_userId: { matterId, userId: leadUserId },
        },
        update: { role: "lead", removedAt: null, removedBy: null },
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

    // Sync the auto-managed SOL Deadline. When the new area tracks
    // SOL we upsert (create or update) the critical deadline; when
    // it doesn't, the helper removes any stale row.
    const existingSolDeadline = await tx.deadline.findFirst({
      where: { matterId, sourceType: SOL_SOURCE_TYPE },
      select: { status: true, completedAt: true },
    });
    // Preserve the existing satisfied state if there was one — the
    // Overview card owns the manual toggle; edits to the deadline
    // date shouldn't undo an earlier satisfied flip.
    const isSatisfied = existingSolDeadline?.status === "completed";
    await syncMatterSolDeadline(tx, {
      matterId,
      trackSol: resolved.hasStatuteOfLimitations,
      date: solDate,
      notes: solNotes,
      satisfied: isSatisfied,
      satisfiedAt: existingSolDeadline?.completedAt ?? null,
      ownerId: leadUserId,
    });
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

// ── Statute of limitations ─────────────────────────────────────────────

/** Flip the SOL-satisfied flag on a matter. Manual for now —
 *  someone on the team has filed the complaint (or had it tolled)
 *  and acknowledges the deadline is cleared. Future: auto-flip when
 *  a linked document is filed + verified. */
export async function setMatterSolSatisfied(
  matterId: string,
  satisfied: boolean
): Promise<{ ok: boolean; error?: string }> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      id: true,
      statuteOfLimitationsDate: true,
      statuteOfLimitationsNotes: true,
      practiceArea: { select: { hasStatuteOfLimitations: true } },
    },
  });
  if (!matter) return { ok: false, error: "Matter not found" };
  if (!matter.practiceArea.hasStatuteOfLimitations) {
    return {
      ok: false,
      error:
        "This matter's practice area doesn't track statute of limitations.",
    };
  }

  const satisfiedAt = satisfied ? new Date() : null;

  // One transaction — flip the matter flag AND the linked critical
  // Deadline's status so the Deadlines tab mirrors the Overview
  // card. The user asked that marking SOL satisfied also satisfy
  // the tied critical deadline.
  await prisma.$transaction(async (tx) => {
    await tx.matter.update({
      where: { id: matterId },
      data: {
        statuteOfLimitationsSatisfied: satisfied,
        statuteOfLimitationsSatisfiedAt: satisfiedAt,
      },
    });
    await syncMatterSolDeadline(tx, {
      matterId,
      trackSol: true,
      date: matter.statuteOfLimitationsDate,
      notes: matter.statuteOfLimitationsNotes,
      satisfied,
      satisfiedAt,
      ownerId: null,
    });
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/deadlines`);
  return { ok: true };
}

// ── Team membership ────────────────────────────────────────────────────
//
// Add / remove team members on a matter.
//
// Permission model: today both actions are admin-gated via
// requireAdmin(). When the firm needs to delegate this (e.g. a "Case
// manager" role), swap the gate for a permission check — the rest of
// the flow stays the same. The audit-trail logActivity call carries
// who-did-what regardless of how permissions evolve.
//
// Soft-delete shape: removing a member sets `removedAt` (and
// `removedBy`) rather than deleting the row, so historical
// attribution stays intact. The (matterId, userId) unique remains —
// re-adding the same user upserts the existing row, clears
// `removedAt`, and applies the new role. That preserves the rule
// "one row per user-matter relationship" without losing the audit
// thread.

const addTeamMemberSchema = z.object({
  userId: z.string().trim().min(1, "Pick a user"),
  role: z.enum(MATTER_TEAM_ROLES),
});

export async function addMatterTeamMember(
  matterId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = addTeamMemberSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      error: flat.userId?.[0] ?? flat.role?.[0] ?? "Invalid input.",
    };
  }
  const { userId, role } = parsed.data;

  const [matter, user] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isActive: true },
    }),
  ]);
  if (!matter) return { ok: false, error: "Matter not found." };
  if (!user || !user.isActive) {
    return { ok: false, error: "User not found or deactivated." };
  }

  // Lead is unique per matter — when promoting a new lead, retire
  // any existing active lead first. We don't auto-demote them off
  // the team; they keep their seat at the new role co_counsel
  // (closest-to-equivalent default). Admin can change it after
  // if they want.
  await prisma.$transaction(async (tx) => {
    if (role === "lead") {
      await tx.matterTeamMember.updateMany({
        where: {
          matterId,
          role: "lead",
          removedAt: null,
          NOT: { userId },
        },
        data: { role: "co_counsel" },
      });
    }

    // Upsert: if the user previously left the team, clear their
    // removedAt and restore them at the new role; otherwise create
    // a fresh row. The unique (matterId, userId) makes this a
    // single statement.
    await tx.matterTeamMember.upsert({
      where: { matterId_userId: { matterId, userId } },
      create: { matterId, userId, role },
      update: { role, removedAt: null, removedBy: null },
    });
  });

  await logActivity({
    matterId,
    userId: actorId,
    type: "filing",
    title: `${user.name} added to team as ${matterTeamRoleLabel(role)}`,
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMatterTeamMember(
  matterId: string,
  membershipId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const actorId = await getCurrentUserId();

  const member = await prisma.matterTeamMember.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      matterId: true,
      role: true,
      removedAt: true,
      user: { select: { name: true } },
    },
  });
  if (!member || member.matterId !== matterId) {
    return { ok: false, error: "Team membership not found." };
  }
  if (member.removedAt) {
    return { ok: false, error: "This person has already been removed." };
  }

  // Refuse to leave a matter without a lead. The admin can promote
  // someone else first (which auto-demotes the current lead), or
  // delete the matter outright if it's truly being abandoned.
  if (member.role === "lead") {
    return {
      ok: false,
      error:
        "Can't remove the lead attorney without first promoting another team member to lead.",
    };
  }

  await prisma.matterTeamMember.update({
    where: { id: member.id },
    data: { removedAt: new Date(), removedBy: actorId },
  });

  await logActivity({
    matterId,
    userId: actorId,
    type: "filing",
    title: `${member.user.name} removed from team (${matterTeamRoleLabel(member.role)})`,
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/", "layout");
  return { ok: true };
}
