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
import { requirePermission } from "@/lib/permission-check";

export type SettlementFormState = {
  status: "idle" | "ok" | "error";
  /** Mirrors `zod.flatten().fieldErrors` — value may be undefined
   *  per zod's typing. The UI checks `errs.foo?.[0]` everywhere. */
  errors?: Record<string, string[] | undefined>;
  error?: string;
};

export const settlementInitialState: SettlementFormState = {
  status: "idle",
};

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
    await prisma.settlement.create({
      data: {
        matterId,
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
      title: `Settlement opened · gross $${grossAmount.toFixed(2)}`,
      detail: `Status: ${data.status}`,
    });
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
      settlement: { select: { matterId: true } },
    },
  });
  if (!lien) return { status: "error", error: "Lien not found." };

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
