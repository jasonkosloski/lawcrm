/**
 * Practice area + stage server actions.
 *
 * CRUD for the lookup tables behind matter.practiceArea and matter.stage.
 * Every mutation revalidates `/` as a layout so the sidebar's area
 * counts + matter pickers refresh everywhere. No hard deletes — areas
 * and stages archive (isActive: false) to keep historical matter
 * references intact.
 *
 * Gated on `firm.manage_practice_areas` — practice areas + stages
 * are firm-wide governance, not per-user preferences. Every action
 * below calls `requirePermission("firm.manage_practice_areas")`
 * before mutating; non-admins without that permission are bounced
 * via redirect (no in-form error). Admin always has every
 * permission, so existing admin flows continue to work.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { BILLING_MODES } from "@/lib/billing-mode-constants";
import type {
  PracticeAreaFormState,
  StageFormState,
} from "@/lib/practice-area-constants";

/** Default lifecycle applied to a newly-created practice area so it's
 *  immediately usable. Firms can rename/reorder/add/remove stages
 *  afterwards in the area detail view. */
const DEFAULT_STAGE_TEMPLATE: Array<{ name: string; isTerminal?: boolean }> = [
  { name: "Intake" },
  { name: "Pre-suit" },
  { name: "Retained" },
  { name: "Discovery" },
  { name: "Dispositive" },
  { name: "Pretrial" },
  { name: "Cert" },
  { name: "Trial/Settle" },
  { name: "Settled", isTerminal: true },
  { name: "Closed", isTerminal: true },
];

// ── Practice area ───────────────────────────────────────────────────────

const practiceAreaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name is too long"),
  label: z.string().trim().max(120).optional().or(z.literal("")),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex (e.g. #2563a8)"),
  /** When "on", matters in this area surface a statute-of-limitations
   *  card on the Overview tab and expose SOL fields on the new/edit
   *  forms. */
  hasStatuteOfLimitations: z.literal("on").optional(),
  /** Billing flow new matters in this area inherit on create. The
   *  edit form posts a string; we accept any value the enum knows
   *  about and fall back to "client" for stale forms posting an
   *  unknown value. */
  defaultBillingMode: z.enum(BILLING_MODES).optional(),
});

/** Create a new practice area + auto-seed the default 10-stage
 *  lifecycle. Redirects to the detail page on success. */
export async function createPracticeArea(
  _prev: PracticeAreaFormState,
  formData: FormData
): Promise<PracticeAreaFormState> {
  await requirePermission("firm.manage_practice_areas");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = practiceAreaSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  const data = parsed.data;

  // Check for name collision — including archived rows, since the
  // unique constraint doesn't honor soft-delete.
  const existing = await prisma.practiceArea.findUnique({
    where: { name: data.name },
    select: { id: true, isActive: true },
  });
  if (existing) {
    return {
      status: "error",
      errors: {
        name: [
          existing.isActive
            ? "A practice area with that name already exists"
            : "A soft-archived area with that name exists — restore it from the archive instead",
        ],
      },
      values: raw,
    };
  }

  // Append at the end of the current ordering.
  const last = await prisma.practiceArea.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = (last?.order ?? -1) + 1;

  const area = await prisma.practiceArea.create({
    data: {
      name: data.name,
      label: data.label || null,
      color: data.color,
      order: nextOrder,
      hasStatuteOfLimitations: data.hasStatuteOfLimitations === "on",
      // Defaulted to "client" at the column level; the create form
      // doesn't expose a picker (kept lean), so this only matters
      // if a future form posts the field.
      ...(data.defaultBillingMode
        ? { defaultBillingMode: data.defaultBillingMode }
        : {}),
      stages: {
        create: DEFAULT_STAGE_TEMPLATE.map((s, i) => ({
          name: s.name,
          order: i,
          isTerminal: s.isTerminal ?? false,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath("/", "layout");
  redirect(`/settings/practice-areas/${area.id}`);
}

export async function updatePracticeArea(
  id: string,
  _prev: PracticeAreaFormState,
  formData: FormData
): Promise<PracticeAreaFormState> {
  await requirePermission("firm.manage_practice_areas");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = practiceAreaSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  const data = parsed.data;

  const collision = await prisma.practiceArea.findFirst({
    where: { name: data.name, NOT: { id } },
    select: { id: true },
  });
  if (collision) {
    return {
      status: "error",
      errors: { name: ["Another practice area already uses that name"] },
      values: raw,
    };
  }

  await prisma.practiceArea.update({
    where: { id },
    data: {
      name: data.name,
      label: data.label || null,
      color: data.color,
      hasStatuteOfLimitations: data.hasStatuteOfLimitations === "on",
      // Only write when the form actually posted a value — keeps
      // forward-compat with older forms that don't include the
      // select.
      ...(data.defaultBillingMode
        ? { defaultBillingMode: data.defaultBillingMode }
        : {}),
    },
  });

  revalidatePath("/", "layout");
  return { status: "ok", values: raw };
}

export async function setPracticeAreaActive(
  id: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("firm.manage_practice_areas");
  if (!isActive) {
    // Block archive if the area still owns active (non-archived) matters.
    // Firms should move those first or explicitly archive the matters.
    const activeMatterCount = await prisma.matter.count({
      where: { practiceAreaId: id, isArchived: false },
    });
    if (activeMatterCount > 0) {
      return {
        ok: false,
        error: `Cannot archive — ${activeMatterCount} active matter${activeMatterCount === 1 ? "" : "s"} still use this area. Reassign or archive the matters first.`,
      };
    }
  }
  await prisma.practiceArea.update({
    where: { id },
    data: { isActive },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Shift a practice area up or down in the global ordering. Uses a
 *  swap with the adjacent neighbour so `order` values stay dense. */
export async function movePracticeArea(
  id: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("firm.manage_practice_areas");
  const all = await prisma.practiceArea.findMany({
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return { ok: false, error: "Not found" };
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= all.length) return { ok: true };

  const a = all[idx];
  const b = all[targetIdx];
  await prisma.$transaction([
    prisma.practiceArea.update({
      where: { id: a.id },
      data: { order: b.order },
    }),
    prisma.practiceArea.update({
      where: { id: b.id },
      data: { order: a.order },
    }),
  ]);

  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Stages ──────────────────────────────────────────────────────────────

const stageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name is too long"),
  isTerminal: z.literal("on").optional(),
});

export async function createStage(
  practiceAreaId: string,
  _prev: StageFormState,
  formData: FormData
): Promise<StageFormState> {
  await requirePermission("firm.manage_practice_areas");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const collision = await prisma.matterStage.findUnique({
    where: {
      practiceAreaId_name: { practiceAreaId, name: parsed.data.name },
    },
    select: { id: true },
  });
  if (collision) {
    return {
      status: "error",
      errors: { name: ["A stage with that name already exists in this area"] },
      values: raw,
    };
  }

  const last = await prisma.matterStage.findFirst({
    where: { practiceAreaId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = (last?.order ?? -1) + 1;

  await prisma.matterStage.create({
    data: {
      practiceAreaId,
      name: parsed.data.name,
      isTerminal: parsed.data.isTerminal === "on",
      order: nextOrder,
    },
  });

  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function updateStage(
  stageId: string,
  _prev: StageFormState,
  formData: FormData
): Promise<StageFormState> {
  await requirePermission("firm.manage_practice_areas");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const stage = await prisma.matterStage.findUnique({
    where: { id: stageId },
    select: { practiceAreaId: true },
  });
  if (!stage) {
    return {
      status: "error",
      errors: { name: ["Stage not found"] },
      values: raw,
    };
  }

  const collision = await prisma.matterStage.findFirst({
    where: {
      practiceAreaId: stage.practiceAreaId,
      name: parsed.data.name,
      NOT: { id: stageId },
    },
    select: { id: true },
  });
  if (collision) {
    return {
      status: "error",
      errors: {
        name: ["Another stage in this area already uses that name"],
      },
      values: raw,
    };
  }

  await prisma.matterStage.update({
    where: { id: stageId },
    data: {
      name: parsed.data.name,
      isTerminal: parsed.data.isTerminal === "on",
    },
  });

  revalidatePath("/", "layout");
  return { status: "ok", values: raw };
}

export async function setStageActive(
  stageId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("firm.manage_practice_areas");
  if (!isActive) {
    const matterCount = await prisma.matter.count({
      where: { stageId, isArchived: false },
    });
    if (matterCount > 0) {
      return {
        ok: false,
        error: `Cannot archive — ${matterCount} active matter${matterCount === 1 ? "" : "s"} still sit in this stage. Move them first.`,
      };
    }
  }
  await prisma.matterStage.update({
    where: { id: stageId },
    data: { isActive },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function moveStage(
  stageId: string,
  direction: "up" | "down"
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("firm.manage_practice_areas");
  const stage = await prisma.matterStage.findUnique({
    where: { id: stageId },
    select: { practiceAreaId: true, order: true },
  });
  if (!stage) return { ok: false, error: "Stage not found" };

  const siblings = await prisma.matterStage.findMany({
    where: { practiceAreaId: stage.practiceAreaId },
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });
  const idx = siblings.findIndex((s) => s.id === stageId);
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings.length) return { ok: true };

  const a = siblings[idx];
  const b = siblings[targetIdx];
  await prisma.$transaction([
    prisma.matterStage.update({
      where: { id: a.id },
      data: { order: b.order },
    }),
    prisma.matterStage.update({
      where: { id: b.id },
      data: { order: a.order },
    }),
  ]);

  revalidatePath("/", "layout");
  return { ok: true };
}
