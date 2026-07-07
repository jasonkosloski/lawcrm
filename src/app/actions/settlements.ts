/**
 * Settlement server actions.
 *
 * v1 scope:
 *   - upsertSettlement(matterId, formData) — create or update the
 *     matter's single Settlement row. Captures gross / fee % /
 *     advanced costs / status.
 *   - addSettlementLien(settlementId, formData) — append a lien
 *     row (medical provider, subrogation, etc.).
 *   - updateSettlementLien(lienId, formData) — change the
 *     negotiated amount + status.
 *   - deleteSettlementLien(lienId) — remove a lien outright (only
 *     when the settlement is still pending).
 *
 * The actual waterfall math (firmFee / lienTotal / clientNet) lives
 * on the read side in `lib/queries/settlements.ts` so the source of
 * truth is the user-entered numbers, not a derived column that
 * could drift.
 *
 * Permission gates per the granular catalog:
 *   - matters.settlement.edit         → upsertSettlement
 *   - matters.settlement.manage_liens → add / update / delete liens
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import { createNotifications } from "@/lib/notifications";
import { requirePermission } from "@/lib/permission-check";
import type { SettlementFormState } from "@/lib/settlement-constants";

// UI clients import `SettlementFormState` + `settlementInitialState`
// directly from `@/lib/settlement-constants`. We don't re-export
// from this "use server" file — Next 16's server bundler emits
// type re-exports as runtime references, which then crash with
// `SettlementFormState is not defined` since the symbol doesn't
// exist as a value.

// Money parser shared with billing actions — strip $ + commas,
// validate decimal shape. Use the explicit result type so the
// schema flowed through `safeParse` carries `string` (post-
// transform) instead of zod's internal effects shape.
const moneyField = (required: boolean) => {
  const base = z
    .string()
    .trim()
    .transform((v: string) => v.replace(/[$,]/g, ""));
  return required
    ? base
        .refine((v: string) => v.length > 0, "Required")
        .refine(
          (v: string) => /^\d+(\.\d{1,2})?$/.test(v),
          "Enter a valid amount"
        )
    : base.refine(
        (v: string) => v === "" || /^\d+(\.\d{1,2})?$/.test(v),
        "Enter a valid amount"
      );
};

const upsertSchema = z.object({
  grossAmount: moneyField(true).refine(
    (v) => parseFloat(v) > 0,
    "Gross must be greater than 0"
  ),
  /** Percent as a number — "33.33" not "0.3333". Stored as
   *  Decimal in the same form. Optional; firms running hourly
   *  contingency hybrids may set firmFee directly. */
  firmFeePercent: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) =>
        !v ||
        (/^\d+(\.\d{1,2})?$/.test(v) &&
          parseFloat(v) >= 0 &&
          parseFloat(v) <= 100),
      "Percent must be 0–100"
    ),
  /** Explicit fee column. Only used when percent is blank. */
  firmFee: moneyField(false),
  advancedCosts: moneyField(false),
  status: z.enum(["pending", "approved", "disbursed", "closed"]),
});

export async function upsertSettlement(
  matterId: string,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  await requirePermission("matters.settlement.edit");
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = upsertSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) return { status: "error", error: "Matter not found." };

  const existing = await prisma.settlement.findFirst({
    where: { matterId },
    select: { id: true },
  });

  const grossAmount = new Prisma.Decimal(data.grossAmount);
  const firmFeePercent = data.firmFeePercent
    ? new Prisma.Decimal(data.firmFeePercent)
    : null;
  // When percent is set, recompute firmFee on the way in so the
  // stored column matches. The query layer also recomputes on
  // read, so this is belt-and-suspenders.
  const firmFee = firmFeePercent
    ? grossAmount.mul(firmFeePercent).div(100)
    : data.firmFee
      ? new Prisma.Decimal(data.firmFee)
      : new Prisma.Decimal(0);
  const advancedCosts = data.advancedCosts
    ? new Prisma.Decimal(data.advancedCosts)
    : new Prisma.Decimal(0);

  if (existing) {
    await prisma.settlement.update({
      where: { id: existing.id },
      data: {
        grossAmount,
        firmFeePercent,
        firmFee,
        advancedCosts,
        status: data.status,
      },
    });
    await logActivity({
      matterId,
      userId: actorId,
      type: "settlement",
      title: `Settlement updated · gross $${grossAmount.toFixed(2)}`,
      detail: `Status: ${data.status}`,
    });
  } else {
    // Seed the default 4-step approval chain on first create. The
    // labels reflect the typical contingency-distribution workflow;
    // firms with a different chain can edit step labels later when
    // we expose a "manage steps" UI.
    const created = await prisma.settlement.create({
      data: {
        matterId,
        grossAmount,
        firmFeePercent,
        firmFee,
        advancedCosts,
        status: data.status,
        approvals: {
          create: [
            { step: 1, label: "Client release signed" },
            { step: 2, label: "Lien negotiations finalized" },
            { step: 3, label: "Partner sign-off" },
            { step: 4, label: "Trust ledger reconciliation" },
          ],
        },
      },
      select: { id: true },
    });
    await logActivity({
      matterId,
      userId: actorId,
      type: "settlement",
      title: `Settlement opened · gross $${grossAmount.toFixed(2)}`,
      detail: `Status: ${data.status} · 4-step approval chain seeded`,
    });
    // The created variable is unused locally but kept so future
    // logic that needs the new id has it.
    void created;
  }

  revalidatePath(`/matters/${matterId}/billing`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { status: "ok" };
}

// ── Liens ─────────────────────────────────────────────────────────────

const lienAddSchema = z.object({
  lienholder: z.string().trim().min(1, "Lienholder is required").max(200),
  lienholderType: z
    .enum(["hospital", "physician", "insurance", "government", "other"])
    .optional()
    .or(z.literal("")),
  originalAmount: moneyField(true).refine(
    (v) => parseFloat(v) > 0,
    "Amount must be greater than 0"
  ),
});

export async function addSettlementLien(
  settlementId: string,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  await requirePermission("matters.settlement.manage_liens");
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = lienAddSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: { id: true, matterId: true, status: true },
  });
  if (!settlement) return { status: "error", error: "Settlement not found." };
  if (settlement.status === "disbursed" || settlement.status === "closed") {
    return {
      status: "error",
      error:
        "Can't add liens to a disbursed/closed settlement — reopen it first.",
    };
  }

  const lien = await prisma.settlementLien.create({
    data: {
      settlementId: settlement.id,
      lienholder: data.lienholder,
      lienholderType: data.lienholderType || null,
      originalAmount: new Prisma.Decimal(data.originalAmount),
    },
    select: { id: true, lienholder: true, originalAmount: true },
  });

  await logActivity({
    matterId: settlement.matterId,
    userId: actorId,
    type: "settlement",
    title: `Lien added · ${lien.lienholder} · $${lien.originalAmount.toFixed(2)}`,
  });

  revalidatePath(`/matters/${settlement.matterId}/billing`);
  revalidatePath(`/matters/${settlement.matterId}/timeline`);
  return { status: "ok" };
}

const lienUpdateSchema = z.object({
  /** Negotiated amount — blank means "still negotiating, use the
   *  original." Pass an explicit "0" to record a write-off. */
  negotiatedAmount: moneyField(false),
  status: z.enum(["pending", "negotiating", "signed", "verified", "paid"]),
});

export async function updateSettlementLien(
  lienId: string,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  await requirePermission("matters.settlement.manage_liens");
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = lienUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const lien = await prisma.settlementLien.findUnique({
    where: { id: lienId },
    select: {
      id: true,
      lienholder: true,
      settlement: { select: { matterId: true, status: true } },
    },
  });
  if (!lien) return { status: "error", error: "Lien not found." };
  // Same post-disbursement lock as add/delete: the waterfall is
  // recomputed on read, so editing a negotiated amount after the
  // money moved would silently change firmFee/lienTotal/clientNet.
  if (
    lien.settlement.status === "disbursed" ||
    lien.settlement.status === "closed"
  ) {
    return {
      status: "error",
      error:
        "Settlement is disbursed/closed — liens are locked. Reopen it first.",
    };
  }

  await prisma.settlementLien.update({
    where: { id: lien.id },
    data: {
      negotiatedAmount: data.negotiatedAmount
        ? new Prisma.Decimal(data.negotiatedAmount)
        : null,
      status: data.status,
    },
  });

  await logActivity({
    matterId: lien.settlement.matterId,
    userId: actorId,
    type: "settlement",
    title: `Lien updated · ${lien.lienholder} → ${data.status}`,
    detail: data.negotiatedAmount
      ? `Negotiated: $${data.negotiatedAmount}`
      : undefined,
  });

  revalidatePath(`/matters/${lien.settlement.matterId}/billing`);
  revalidatePath(`/matters/${lien.settlement.matterId}/timeline`);
  return { status: "ok" };
}

export async function deleteSettlementLien(
  lienId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("matters.settlement.manage_liens");
  const actorId = await getCurrentUserId();

  const lien = await prisma.settlementLien.findUnique({
    where: { id: lienId },
    select: {
      id: true,
      lienholder: true,
      settlement: { select: { matterId: true, status: true } },
    },
  });
  if (!lien) return { ok: false, error: "Lien not found." };
  if (
    lien.settlement.status === "disbursed" ||
    lien.settlement.status === "closed"
  ) {
    return {
      ok: false,
      error: "Settlement is closed — can't remove liens after disbursement.",
    };
  }

  await prisma.settlementLien.delete({ where: { id: lien.id } });

  await logActivity({
    matterId: lien.settlement.matterId,
    userId: actorId,
    type: "settlement",
    title: `Lien removed · ${lien.lienholder}`,
  });

  revalidatePath(`/matters/${lien.settlement.matterId}/billing`);
  revalidatePath(`/matters/${lien.settlement.matterId}/timeline`);
  return { ok: true };
}

// ── Approval steps ────────────────────────────────────────────────────

/** Set an approval step's status. The "approverId" snapshot is
 *  the current user when transitioning to "approved" (the
 *  attribution is the audit). Resetting to "pending" or
 *  rejecting clears the snapshot. */
export async function setApprovalStepStatus(
  approvalId: string,
  status: "pending" | "approved" | "rejected",
  notes?: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("matters.settlement.approve");
  const actorId = await getCurrentUserId();

  const approval = await prisma.settlementApproval.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      step: true,
      label: true,
      status: true,
      settlement: { select: { id: true, matterId: true, status: true } },
    },
  });
  if (!approval) return { ok: false, error: "Approval step not found." };
  if (
    approval.settlement.status === "disbursed" ||
    approval.settlement.status === "closed"
  ) {
    return {
      ok: false,
      error:
        "Settlement is already disbursed or closed — approvals are locked.",
    };
  }

  await prisma.settlementApproval.update({
    where: { id: approval.id },
    data: {
      status,
      approverId: status === "approved" ? actorId : null,
      approvedAt: status === "approved" ? new Date() : null,
      notes: notes && notes.trim().length > 0 ? notes.trim() : null,
    },
  });

  // Auto-promote the settlement to "approved" status when every
  // step is approved. We don't auto-disburse — that's a separate
  // money-moving action that needs explicit confirmation.
  const allSteps = await prisma.settlementApproval.findMany({
    where: { settlementId: approval.settlement.id },
    select: { status: true },
  });
  const allApproved =
    allSteps.length > 0 && allSteps.every((s) => s.status === "approved");
  if (
    allApproved &&
    approval.settlement.status !== "approved" &&
    approval.settlement.status !== "disbursed" &&
    approval.settlement.status !== "closed"
  ) {
    await prisma.settlement.update({
      where: { id: approval.settlement.id },
      data: { status: "approved" },
    });
  }

  await logActivity({
    matterId: approval.settlement.matterId,
    userId: actorId,
    type: "settlement",
    title: `Settlement step ${approval.step} (${approval.label}) → ${status}`,
    detail: notes ?? undefined,
  });

  // ── Notification fan-out ──────────────────────────────────────────
  // Only on a REAL transition (re-clicking the same status is a
  // no-op ping-wise), and only for approve/reject — resets to
  // "pending" are housekeeping, not news. The approval chain has no
  // per-step assignee (approverId is a who-approved snapshot, not a
  // who's-next assignment), so "the next approver" is addressed as
  // the matter's active team: whoever holds
  // `matters.settlement.approve` sees it in their bell.
  if (approval.status !== status && status !== "pending") {
    const matterId = approval.settlement.matterId;
    const [matter, team] = await Promise.all([
      prisma.matter.findUnique({
        where: { id: matterId },
        select: { name: true },
      }),
      prisma.matterTeamMember.findMany({
        where: { matterId, removedAt: null },
        select: { userId: true, role: true },
      }),
    ]);
    const link = `/matters/${matterId}/billing`;

    if (status === "approved") {
      // Next pending step (post-update read, so the just-approved
      // step is already excluded) — its label tells the team whose
      // turn it is. No pending step left = the chain is complete.
      const nextStep = await prisma.settlementApproval.findFirst({
        where: { settlementId: approval.settlement.id, status: "pending" },
        orderBy: { step: "asc" },
        select: { step: true, label: true },
      });
      const recipients = team
        .map((t) => t.userId)
        .filter((id) => id !== actorId);
      await createNotifications(recipients, {
        type: "settlement_step_approved",
        title: `Settlement step approved: ${approval.label}`,
        body: nextStep
          ? `${matter?.name ?? "Matter"} · next up: step ${nextStep.step} — ${nextStep.label}`
          : `${matter?.name ?? "Matter"} · all steps approved — settlement ready to disburse`,
        link,
        matterId,
      });
    } else {
      // Rejection goes to the matter lead(s) — the settlement's
      // initiator isn't recorded on the row, and the lead owns
      // unblocking the chain either way.
      const recipients = team
        .filter((t) => t.role === "lead")
        .map((t) => t.userId)
        .filter((id) => id !== actorId);
      await createNotifications(recipients, {
        type: "settlement_step_rejected",
        title: `Settlement step rejected: ${approval.label}`,
        body: notes?.trim()
          ? `${matter?.name ?? "Matter"} · ${notes.trim()}`
          : `${matter?.name ?? "Matter"} · step ${approval.step} of the approval chain`,
        link,
        matterId,
      });
    }
  }

  revalidatePath(`/matters/${approval.settlement.matterId}/billing`);
  revalidatePath(`/matters/${approval.settlement.matterId}/timeline`);
  return { ok: true };
}
