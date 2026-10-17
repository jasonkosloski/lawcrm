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
import { prisma, type Tx } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { createNotification } from "@/lib/notifications";
import { getEffectiveCalendarDefaults } from "@/lib/calendar-defaults";
import { BILLING_MODES } from "@/lib/billing-mode-constants";
import {
  SOL_SOURCE_TYPE,
  computeSolDate,
  resolveEditedSolDate,
  toSolPeriod,
  type SolPeriod,
} from "@/lib/sol";
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import { getCurrentFirm } from "@/lib/firm";
import { applyAutoDefaults, describeDefaults } from "@/lib/automations/apply";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
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
     *  hasStatuteOfLimitations=true. Form shows them conditionally.
     *  When the area has a configured statutePeriodAmount/Unit AND
     *  incidentDate is filled in, the SOL date is auto-computed
     *  on submit; the explicit `statuteOfLimitationsDate` value
     *  (if any) wins so the lawyer can override. */
    incidentDate: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
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

// SOL_SOURCE_TYPE (src/lib/sol.ts) identifies the one auto-managed SOL
// deadline per matter. Manually-created deadlines (kind="critical" via
// the Deadlines tab composer) don't set it, so we can find-and-update
// cleanly without clobbering unrelated rows.

/** Keeps the auto-managed "Statute of limitations" Deadline row in
 *  sync with the matter's SOL fields. Called from create + update +
 *  setMatterSolSatisfied so all three paths maintain the invariant:
 *
 *  - SOL date present → a critical Deadline exists with that dueDate
 *  - SOL cleared → deadline is removed
 *  - `applyStatus` (setMatterSolSatisfied): satisfied=true → status
 *    "completed", satisfied=false → "open". Plain matter saves leave an
 *    existing row's status alone (someone may have completed/waived it
 *    on the Deadlines tab) and only use the flag when (re)creating it.
 *  - `ownerId` is used when creating the row; on an existing row it is
 *    applied only when provided (undefined = keep the current owner), so
 *    toggling "satisfied" can't orphan the deadline's owner.
 */
async function syncMatterSolDeadline(
  tx: Tx | typeof prisma,
  opts: {
    matterId: string;
    trackSol: boolean;
    date: Date | null;
    notes: string | null;
    satisfied: boolean;
    satisfiedAt: Date | null;
    ownerId?: string | null;
    /** Owner for a newly created row when `ownerId` is undefined. */
    createOwnerId?: string | null;
    applyStatus?: boolean;
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

  const status = opts.satisfied ? "completed" : "open";
  const completedAt = opts.satisfied ? opts.satisfiedAt : null;
  const base = {
    title: "Statute of limitations",
    dueDate: opts.date,
    kind: "critical" as const,
    sourceType: SOL_SOURCE_TYPE,
    description: opts.notes,
  };
  if (existing) {
    await tx.deadline.update({
      where: { id: existing.id },
      data: {
        ...base,
        ...(opts.ownerId !== undefined ? { ownerId: opts.ownerId } : {}),
        ...(opts.applyStatus ? { status, completedAt } : {}),
      },
    });
  } else {
    await tx.deadline.create({
      data: {
        matterId: opts.matterId,
        ...base,
        ownerId: opts.ownerId ?? opts.createOwnerId ?? null,
        status,
        completedAt,
      },
    });
  }
}

/** Strictly parse the posted incident + SOL date strings (only when the
 *  area tracks SOL — otherwise they are ignored). A malformed value
 *  becomes a field error instead of an Invalid Date reaching Prisma. */
function parseSolDates(
  tracks: boolean,
  incidentRaw: string | undefined,
  solRaw: string | undefined
):
  | { ok: true; incident: Date | null; sol: Date | null }
  | { ok: false; errors: Record<string, string[]> } {
  if (!tracks) return { ok: true, incident: null, sol: null };
  const errors: Record<string, string[]> = {};
  const incident = incidentRaw ? parseDateOnly(incidentRaw) : null;
  if (incidentRaw && !incident) errors.incidentDate = ["Enter a valid date"];
  const sol = solRaw ? parseDateOnly(solRaw) : null;
  if (solRaw && !sol) errors.statuteOfLimitationsDate = ["Enter a valid date"];
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, incident, sol };
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
      areaName: string;
      color: string;
      hasStatuteOfLimitations: boolean;
      /** Calendar statute period configured by the firm (ADR-035).
       *  Drives auto-compute of the matter's SOL date from incidentDate. */
      statutePeriod: SolPeriod | null;
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
      name: true,
      color: true,
      isActive: true,
      hasStatuteOfLimitations: true,
      statutePeriodAmount: true,
      statutePeriodUnit: true,
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
    areaName: area.name,
    color: area.color,
    hasStatuteOfLimitations: area.hasStatuteOfLimitations,
    statutePeriod: toSolPeriod(area.statutePeriodAmount, area.statutePeriodUnit),
    defaultBillingMode: area.defaultBillingMode,
  };
}

export async function createMatter(
  _prev: CreateMatterState,
  formData: FormData
): Promise<CreateMatterState> {
  await requirePermission("matters.create");
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

  const [currentUserId, tz] = await Promise.all([
    getCurrentUserId(),
    getCurrentUserTimeZone(),
  ]);
  // Contact.firmId is stamped by the action layer on every new write
  // (schema comment); only an inline new client needs it here.
  const firmId =
    data.clientId === NEW_CLIENT_SENTINEL ? (await getCurrentFirm()).id : null;

  // Verify the selected lead is a real, active user; fall through to
  // the current user if the posted value is stale or the user has
  // since been deactivated (mirrors addMatterTeamMember's guard).
  const lead = await prisma.user.findUnique({
    where: { id: data.leadUserId },
    select: { id: true, isActive: true },
  });
  const leadUserId = lead?.isActive ? lead.id : currentUserId;

  // Only persist SOL fields when the area actually tracks them;
  // otherwise drop them on the floor so a stale form submission from
  // an area that used to track SOL doesn't leave dangling dates.
  const parsedDates = parseSolDates(
    resolved.hasStatuteOfLimitations,
    data.incidentDate,
    data.statuteOfLimitationsDate
  );
  if (!parsedDates.ok) {
    return { status: "error", errors: parsedDates.errors, values: raw };
  }
  const incidentDate = parsedDates.incident;
  // Manual override wins; otherwise auto-compute from
  // incidentDate + the area's statute period.
  const solDate =
    resolved.hasStatuteOfLimitations
      ? (parsedDates.sol ??
        computeSolDate(incidentDate, resolved.statutePeriod))
      : null;
  const solNotes =
    resolved.hasStatuteOfLimitations
      ? data.statuteOfLimitationsNotes || null
      : null;

  // Inline client, matter, and SOL deadline are dependent writes —
  // one transaction so a failed matter.create can't strand an
  // orphaned Contact (+ContactPhone), and a matter can't exist
  // without its critical SOL Deadline. Mirrors updateMatter and
  // convertLeadToMatter, which already run transactionally.
  const { matter, defaults } = await prisma.$transaction(async (tx) => {
    // Resolve client: either pick an existing Contact, create a new
    // one inline, or leave null.
    let clientId: string | null = null;
    if (data.clientId === NEW_CLIENT_SENTINEL) {
      const newClient = await tx.contact.create({
        data: {
          name: data.newClientName!,
          email: data.newClientEmail || null,
          phone: data.newClientPhone || null,
          organization: data.newClientOrganization || null,
          type: "client",
          firmId,
        },
        select: { id: true },
      });
      clientId = newClient.id;
      // Seed a first-class primary ContactPhone row so the contact
      // starts with a real phone record the Parties edit form can
      // manage. Denormalized Contact.phone above keeps old readers happy.
      if (data.newClientPhone) {
        await tx.contactPhone.create({
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
      const client = await tx.contact.findUnique({
        where: { id: data.clientId },
        select: { id: true },
      });
      clientId = client?.id ?? null;
    }

    const created = await tx.matter.create({
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
        incidentDate,
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
    await syncMatterSolDeadline(tx, {
      matterId: created.id,
      trackSol: resolved.hasStatuteOfLimitations,
      date: solDate,
      notes: solNotes,
      satisfied: false,
      satisfiedAt: null,
      ownerId: leadUserId,
    });

    // Firm-configured defaults (Settings → Automations): deadline
    // rules + task lists set to apply when a matter is created in
    // this practice area (or any). Same transaction — a matter never
    // exists without the deadlines the firm said it must have.
    const defaults = await applyAutoDefaults(tx, {
      matterId: created.id,
      practiceAreaId: resolved.practiceAreaId,
      trigger: "matter_created",
      tz,
    });

    return { matter: created, defaults };
  });

  await logActivity({
    matterId: matter.id,
    userId: currentUserId,
    type: "filing",
    title: "Matter created",
    detail: [
      `${data.name} — ${resolved.areaName}`,
      solDate ? `Statute of limitations ${dateOnlyKey(solDate)}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  });

  const defaultsLine = describeDefaults(defaults);
  if (defaultsLine) {
    await logActivity({
      matterId: matter.id,
      userId: currentUserId,
      type: "automation",
      title: defaultsLine,
    });
  }

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
  /** Optional on update: omitted/blank leaves the current lead alone
   *  (the edit form locks the field without matters.manage_team).
   *  A value that differs from the current lead is a team change and
   *  needs that key. */
  leadUserId: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  incidentDate: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
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
 * Auth: gated on `matters.edit`. Admins short-circuit; other roles
 * need explicit grant via the matrix.
 */
export async function updateMatter(
  matterId: string,
  _prev: UpdateMatterState,
  formData: FormData
): Promise<UpdateMatterState> {
  await requirePermission("matters.edit");
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

  // Everything the diff + authorization checks below compare against.
  const stored = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      name: true,
      caseNumber: true,
      court: true,
      feeStructure: true,
      billingMode: true,
      opposingParty: true,
      opposingFirm: true,
      description: true,
      clientId: true,
      client: { select: { name: true } },
      practiceAreaId: true,
      practiceArea: { select: { name: true } },
      stageId: true,
      stage: { select: { name: true, isTerminal: true } },
      teamMembers: {
        where: { role: "lead", removedAt: null },
        select: { userId: true, user: { select: { name: true } } },
      },
    },
  });
  if (!stored) {
    return {
      status: "error",
      errors: { name: ["Matter not found"] },
      values: raw,
    };
  }

  const currentUserId = await getCurrentUserId();

  // Lead attorney. An unchanged (or omitted) lead is never re-validated:
  // a lead who has since been deactivated stays lead until someone
  // deliberately swaps them. A *change* is a team change, so it needs
  // matters.manage_team (same key as addMatterTeamMember) and must
  // target an active user — it never silently becomes the current user.
  const currentLead = stored.teamMembers[0] ?? null;
  let leadUserId: string | null = currentLead?.userId ?? null;
  let newLeadName: string | null = null;
  if (data.leadUserId && data.leadUserId !== currentLead?.userId) {
    if (!(await currentUserHasPermission("matters.manage_team"))) {
      return {
        status: "error",
        errors: {
          leadUserId: [
            "Changing the lead attorney requires permission to manage the case team.",
          ],
        },
        values: raw,
      };
    }
    const lead = await prisma.user.findUnique({
      where: { id: data.leadUserId },
      select: { id: true, name: true, isActive: true },
    });
    if (!lead?.isActive) {
      return {
        status: "error",
        errors: { leadUserId: ["Lead attorney must be an active user."] },
        values: raw,
      };
    }
    leadUserId = lead.id;
    newLeadName = lead.name;
  }
  const leadChanged = leadUserId !== (currentLead?.userId ?? null);

  // Client. An unchanged client is kept as-is (it may since have been
  // deactivated or re-typed — still the matter's client); a different
  // pick must exist.
  let clientId: string | null = null;
  let newClientName: string | null = null;
  if (data.clientId) {
    if (data.clientId === stored.clientId) {
      clientId = stored.clientId;
      newClientName = stored.client?.name ?? null;
    } else {
      const client = await prisma.contact.findUnique({
        where: { id: data.clientId },
        select: { id: true, name: true },
      });
      if (!client) {
        return {
          status: "error",
          errors: { clientId: ["That client no longer exists"] },
          values: raw,
        };
      }
      clientId = client.id;
      newClientName = client.name;
    }
  }

  // SOL inputs are only meaningful when the (new) area tracks SOL. When
  // it doesn't, the matter's incident date, SOL date/notes and SOL
  // deadline are left exactly as they are — switching to a non-tracking
  // area (or an admin un-ticking SOL on an area) must never wipe them.
  const parsedDates = parseSolDates(
    resolved.hasStatuteOfLimitations,
    data.incidentDate,
    data.statuteOfLimitationsDate
  );
  if (!parsedDates.ok) {
    return { status: "error", errors: parsedDates.errors, values: raw };
  }

  const newStage = await prisma.matterStage.findUnique({
    where: { id: resolved.stageId },
    select: { name: true, isTerminal: true },
  });

  const sol = await prisma.$transaction(async (tx) => {
    // The matter row is the source of truth for the SOL fields and the
    // satisfied flag (setMatterSolSatisfied maintains it); the Deadline
    // row is only a mirror. Read the stored values here, inside the
    // transaction, so the auto-vs-manual decision and the diff agree
    // with what we overwrite.
    const cur = await tx.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: {
        incidentDate: true,
        statuteOfLimitationsDate: true,
        statuteOfLimitationsNotes: true,
        statuteOfLimitationsSatisfied: true,
        statuteOfLimitationsSatisfiedAt: true,
        practiceArea: {
          select: { statutePeriodAmount: true, statutePeriodUnit: true },
        },
      },
    });

    let incidentDate = cur.incidentDate;
    let solDate = cur.statuteOfLimitationsDate;
    let solNotes = cur.statuteOfLimitationsNotes;
    if (resolved.hasStatuteOfLimitations) {
      incidentDate = parsedDates.incident;
      // Auto-derived SOL follows the incident date / area period;
      // a real manual override is kept (see resolveEditedSolDate).
      solDate = resolveEditedSolDate({
        posted: parsedDates.sol,
        stored: cur.statuteOfLimitationsDate,
        storedIncident: cur.incidentDate,
        storedPeriod: toSolPeriod(
          cur.practiceArea.statutePeriodAmount,
          cur.practiceArea.statutePeriodUnit
        ),
        incident: parsedDates.incident,
        period: resolved.statutePeriod,
      });
      solNotes = data.statuteOfLimitationsNotes || null;
    }
    // No SOL date (date cleared while the area tracks SOL) means
    // there's nothing left to satisfy — reset the flags so a re-added
    // date starts back at "open". Untracked areas leave them alone.
    const isSatisfied = solDate
      ? cur.statuteOfLimitationsSatisfied
      : false;
    const satisfiedAt = isSatisfied
      ? cur.statuteOfLimitationsSatisfiedAt
      : null;

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
        ...(resolved.hasStatuteOfLimitations
          ? {
              incidentDate,
              statuteOfLimitationsDate: solDate,
              statuteOfLimitationsNotes: solNotes,
              // Clear the satisfied flag whenever there's no SOL date
              // to satisfy.
              ...(isSatisfied
                ? {}
                : {
                    statuteOfLimitationsSatisfied: false,
                    statuteOfLimitationsSatisfiedAt: null,
                  }),
            }
          : {}),
      },
    });

    // Sync lead. Match addMatterTeamMember's promotion shape: any
    // existing active lead that isn't the new pick gets demoted
    // to co_counsel (humane swap, not an off-team kick), and the
    // new lead is upserted — restoring a former-member row if
    // they previously left the team.
    if (leadChanged && leadUserId) {
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

    // Mirror the SOL fields onto the auto-managed critical Deadline
    // (upsert, or remove when the date was cleared). Skipped entirely
    // when the area doesn't track SOL — the deadline stays put with the
    // preserved matter fields. A plain save keeps the deadline's status
    // and owner; the owner follows the lead only when the lead actually
    // changed and the old lead (or nobody) owned it.
    if (resolved.hasStatuteOfLimitations) {
      const existingSol = await tx.deadline.findFirst({
        where: { matterId, sourceType: SOL_SOURCE_TYPE },
        select: { ownerId: true },
      });
      const ownerFollowsLead =
        leadChanged &&
        (existingSol?.ownerId == null ||
          existingSol.ownerId === currentLead?.userId);
      await syncMatterSolDeadline(tx, {
        matterId,
        trackSol: true,
        date: solDate,
        notes: solNotes,
        satisfied: isSatisfied,
        satisfiedAt,
        ownerId: existingSol
          ? ownerFollowsLead
            ? leadUserId
            : undefined
          : leadUserId,
      });
    }

    return {
      before: {
        incident: cur.incidentDate,
        date: cur.statuteOfLimitationsDate,
        notes: cur.statuteOfLimitationsNotes,
      },
      after: { incident: incidentDate, date: solDate, notes: solNotes },
    };
  });

  // ── Audit trail (after commit; a log failure never rolls back) ───────
  // Field names, ids and dates only — never the matter's privileged
  // free text.
  const dayOrNone = (d: Date | null) => (d ? dateOnlyKey(d) : "none");
  const changed: string[] = [];
  const diff = (label: string, a: unknown, b: unknown) => {
    if ((a ?? "") !== (b ?? "")) changed.push(label);
  };
  diff("name", stored.name, data.name);
  diff("case number", stored.caseNumber, data.caseNumber || null);
  diff("court", stored.court, data.court || null);
  diff("fee structure", stored.feeStructure, data.feeStructure);
  if (data.billingMode) diff("billing mode", stored.billingMode, data.billingMode);
  diff("opposing party", stored.opposingParty, data.opposingParty || null);
  diff("opposing firm", stored.opposingFirm, data.opposingFirm || null);
  diff("summary", stored.description, data.description || null);
  if (stored.practiceAreaId !== resolved.practiceAreaId) {
    changed.push(
      `practice area ${stored.practiceArea.name} → ${resolved.areaName}`
    );
  }
  if (stored.clientId !== clientId) {
    changed.push(
      `client ${stored.client?.name ?? "none"} → ${newClientName ?? "none"}`
    );
  }
  if (
    resolved.hasStatuteOfLimitations &&
    dayOrNone(sol.before.incident) !== dayOrNone(sol.after.incident)
  ) {
    changed.push(
      `incident date ${dayOrNone(sol.before.incident)} → ${dayOrNone(sol.after.incident)}`
    );
  }
  if (
    resolved.hasStatuteOfLimitations &&
    (sol.before.notes ?? "") !== (sol.after.notes ?? "")
  ) {
    changed.push("statute of limitations notes");
  }
  if (changed.length > 0) {
    await logActivity({
      matterId,
      userId: currentUserId,
      type: "filing",
      title: "Matter updated",
      detail: `Changed: ${changed.join("; ")}`,
    });
  }

  if (
    resolved.hasStatuteOfLimitations &&
    dayOrNone(sol.before.date) !== dayOrNone(sol.after.date)
  ) {
    await logActivity({
      matterId,
      userId: currentUserId,
      type: "deadline",
      title: "Statute of limitations changed",
      detail: `${dayOrNone(sol.before.date)} → ${dayOrNone(sol.after.date)}`,
    });
  }

  if (stored.stageId !== resolved.stageId && newStage) {
    await logActivity({
      matterId,
      userId: currentUserId,
      type: "filing",
      title:
        stored.stage.isTerminal && !newStage.isTerminal
          ? `Reopened from ${stored.stage.name} → ${newStage.name}`
          : `Stage moved: ${stored.stage.name} → ${newStage.name}`,
    });
  }

  if (leadChanged) {
    await logActivity({
      matterId,
      userId: currentUserId,
      type: "filing",
      title: "Lead attorney changed",
      detail: `${currentLead?.user.name ?? "none"} → ${newLeadName ?? "none"}`,
    });
  }

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
 * Auth: gated on `matters.edit`, same as the full edit flow.
 *
 * Unusual transitions are surfaced as an explicit confirmation
 * step, NOT as an outright refusal:
 *  - Reopening a terminal matter (terminal → non-terminal)
 *  - Moving the matter backward more than one stage
 *
 * The server returns `{ ok: false, requiresConfirmation, warning }`
 * for those unless the caller passes `force: true`. UI shows the
 * warning, asks the user, then retries with force. That way
 * scripted clients can't accidentally reopen a closed matter from
 * a stale form, but the UI flow stays low-friction.
 *
 * Every successful transition writes an ActivityLog entry so the
 * matter timeline carries the lifecycle history.
 */
export async function updateMatterStage(
  matterId: string,
  newStageId: string,
  options: { force?: boolean } = {}
): Promise<{
  ok: boolean;
  error?: string;
  requiresConfirmation?: boolean;
  warning?: string;
}> {
  await requirePermission("matters.edit");
  const userId = await getCurrentUserId();
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      practiceAreaId: true,
      stage: {
        select: {
          id: true,
          name: true,
          order: true,
          isTerminal: true,
        },
      },
    },
  });
  if (!matter) return { ok: false, error: "Matter not found" };

  const stage = await prisma.matterStage.findUnique({
    where: { id: newStageId },
    select: {
      id: true,
      name: true,
      order: true,
      isTerminal: true,
      practiceAreaId: true,
      isActive: true,
    },
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

  // Same-stage no-op — let the optimistic UI quietly settle.
  if (stage.id === matter.stage.id) {
    return { ok: true };
  }

  // Unusual-transition guards. Skipped when force=true (UI already
  // confirmed). Stack from most-severe to least so the message
  // surfaced is the most relevant.
  if (!options.force) {
    if (matter.stage.isTerminal && !stage.isTerminal) {
      return {
        ok: false,
        requiresConfirmation: true,
        warning: `Reopen this matter? It's currently ${matter.stage.name} (terminal). Confirming will move it to ${stage.name} and re-list it as active.`,
      };
    }
    // Backward jump of more than one slot — could be intentional
    // (case bounced back from settle to discovery) but worth a
    // beat. One-slot backward is normal stepping and doesn't ask.
    if (stage.order < matter.stage.order - 1) {
      return {
        ok: false,
        requiresConfirmation: true,
        warning: `Move ${matter.stage.name} → ${stage.name}? That's ${matter.stage.order - stage.order} stages backward — make sure that's intended.`,
      };
    }
  }

  await prisma.matter.update({
    where: { id: matterId },
    data: { stageId: stage.id },
  });

  // Audit. Two distinct titles so reopens stand out in the
  // timeline ("Reopened …" reads at a glance vs. "Stage moved …").
  await logActivity({
    matterId,
    userId,
    type: "filing",
    title:
      matter.stage.isTerminal && !stage.isTerminal
        ? `Reopened from ${matter.stage.name} → ${stage.name}`
        : `Stage moved: ${matter.stage.name} → ${stage.name}`,
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
  const userId = await requirePermission("matters.edit");
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      id: true,
      statuteOfLimitationsDate: true,
      statuteOfLimitationsNotes: true,
      statuteOfLimitationsSatisfied: true,
      practiceArea: { select: { hasStatuteOfLimitations: true } },
      teamMembers: {
        where: { role: "lead", removedAt: null },
        select: { userId: true },
      },
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
      // Keep the deadline's current owner. Only a re-created row (the
      // old one was removed) falls back to the lead.
      ownerId: undefined,
      applyStatus: true,
      createOwnerId: matter.teamMembers[0]?.userId ?? null,
    });
  });

  // Who cleared (or re-opened) the statute — a timestamp alone can't say.
  if (matter.statuteOfLimitationsSatisfied !== satisfied) {
    await logActivity({
      matterId,
      userId,
      type: "deadline",
      title: satisfied
        ? "Statute of limitations marked satisfied"
        : "Statute of limitations reopened",
      detail: matter.statuteOfLimitationsDate
        ? `SOL date ${dateOnlyKey(matter.statuteOfLimitationsDate)}`
        : null,
    });
  }

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/deadlines`);
  return { ok: true };
}

// ── Team membership ────────────────────────────────────────────────────
//
// Add / remove team members on a matter.
//
// Permission model: gated on `matters.manage_team`. Admin always
// has it; other roles get it via the matrix on /settings/roles.
// The audit-trail logActivity call carries who-did-what so the
// matter timeline has a record regardless of how permissions evolve.
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
  await requirePermission("matters.manage_team");
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
      select: { id: true, name: true, email: true, isActive: true },
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
  const outcome = await prisma.$transaction(async (tx) => {
    // Read the target's current seat inside the transaction. An
    // already-active member at the same role is a no-op (no duplicate
    // log/notification); the active lead can't be re-added at another
    // role, which would demote the only lead and break the
    // at-least-one-lead invariant (removeMatterTeamMember enforces the
    // same rule). Promote someone else to lead first.
    const current = await tx.matterTeamMember.findUnique({
      where: { matterId_userId: { matterId, userId } },
      select: { role: true, removedAt: true },
    });
    if (current && !current.removedAt) {
      if (current.role === role) return "unchanged" as const;
      if (current.role === "lead") return "is_lead" as const;
    }

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
    return "saved" as const;
  });

  if (outcome === "is_lead") {
    return {
      ok: false,
      error: `${user.name} is the lead attorney. Promote another team member to lead first.`,
    };
  }
  if (outcome === "unchanged") return { ok: true };

  await logActivity({
    matterId,
    userId: actorId,
    type: "filing",
    title: `${user.name} added to team as ${matterTeamRoleLabel(role)}`,
  });

  // Auto-add to upcoming events when the effective setting
  // says so. We bound this to events strictly in the future
  // (startTime > now) — past events are historical record;
  // adding someone to them retroactively would imply they
  // attended, which they didn't.
  const defaults = await getEffectiveCalendarDefaults(matterId);
  if (defaults.autoAddTeamToUpcomingEvents) {
    const now = new Date();
    const upcoming = await prisma.calendarEvent.findMany({
      where: { matterId, startTime: { gt: now } },
      select: { id: true },
    });
    if (upcoming.length > 0) {
      // Skip events the user is already on so a re-add doesn't
      // double-attach. Pull their existing memberships in one
      // query keyed by the upcoming event ids.
      const existing = await prisma.calendarAttendee.findMany({
        where: {
          eventId: { in: upcoming.map((e) => e.id) },
          userId,
        },
        select: { eventId: true },
      });
      const existingIds = new Set(existing.map((a) => a.eventId));
      const toAdd = upcoming.filter((e) => !existingIds.has(e.id));
      if (toAdd.length > 0) {
        await prisma.calendarAttendee.createMany({
          // Auto-added teammates → `accepted` so the modal
          // doesn't surface a "Pending" pill for the whole
          // team on every event. Real RSVP semantics will use
          // pending/declined/tentative when the flow lands.
          data: toAdd.map((e) => ({
            eventId: e.id,
            userId,
            name: user.name,
            email: user.email,
            status: "accepted",
          })),
        });
      }
    }
  }

  // Notify the new team member — but skip if they added themselves
  // (no value in pinging your own bell for an action you just took).
  if (userId !== actorId) {
    const matterRow = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { name: true },
    });
    await createNotification({
      userId,
      type: "matter_assigned",
      title: `Added to ${matterRow?.name ?? "a matter"} as ${matterTeamRoleLabel(role)}`,
      body: null,
      link: `/matters/${matterId}`,
      matterId,
    });
  }

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMatterTeamMember(
  matterId: string,
  membershipId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("matters.manage_team");
  const actorId = await getCurrentUserId();

  const member = await prisma.matterTeamMember.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      matterId: true,
      role: true,
      removedAt: true,
      userId: true,
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

  // Removing someone from the team also takes them off the upcoming
  // events addMatterTeamMember auto-attached them to: attendance is
  // itself a calendar-detail unlock path, so leaving the rows would let
  // a former member keep seeing the full details. Only future events on
  // THIS matter, only the auto-add status ("accepted"), and never the
  // events they created themselves.
  const { detached } = await prisma.$transaction(async (tx) => {
    await tx.matterTeamMember.update({
      where: { id: member.id },
      data: { removedAt: new Date(), removedBy: actorId },
    });
    const gone = await tx.calendarAttendee.deleteMany({
      where: {
        userId: member.userId,
        status: "accepted",
        event: {
          matterId,
          startTime: { gt: new Date() },
          // SQL `<>` skips NULL creators (legacy rows), so spell it out.
          OR: [
            { createdById: null },
            { createdById: { not: member.userId } },
          ],
        },
      },
    });
    return { detached: gone.count };
  });

  await logActivity({
    matterId,
    userId: actorId,
    type: "filing",
    title: `${member.user.name} removed from team (${matterTeamRoleLabel(member.role)})`,
    detail:
      detached > 0
        ? `Removed from ${detached} upcoming event${detached === 1 ? "" : "s"}`
        : null,
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/calendar");
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/", "layout");
  return { ok: true };
}
