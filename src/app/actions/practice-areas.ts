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
 *
 * Every mutation writes a firm-level audit entry (type "settings"):
 * practice-area SOL period / citation drive auto-computed deadlines
 * and stage `isTerminal` reclassifies matters as open or closed, so
 * "who changed that and from what" must be answerable.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { BILLING_MODES } from "@/lib/billing-mode-constants";
import {
  SOL_PERIOD_UNITS,
  formatStatutePeriod,
  toSolPeriod,
  type SolPeriod,
} from "@/lib/sol";
import { logAuditEntry } from "@/lib/audit-entry";
import { parseTemplate } from "@/lib/matter-name-template";
import { isRequiredMatterField } from "@/lib/matter-required-fields";
import {
  areaArchiveBlockedMessage,
  planReorder,
  type PracticeAreaFormState,
  type StageFormState,
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

function formatPeriodOrNone(period: SolPeriod | null): string {
  return period ? formatStatutePeriod(period) : "none";
}

/** Firm-level audit row for practice-area / stage settings changes.
 *  `changes` entries that are null (nothing changed) are dropped; when
 *  nothing changed at all, no row is written. */
async function logSettingsChange(
  userId: string,
  title: string,
  changes: Array<string | null>,
  skipIfNoChanges = false
): Promise<void> {
  const list = changes.filter((c): c is string => c !== null);
  if (list.length === 0 && skipIfNoChanges) return;
  await logAuditEntry({
    matterId: null,
    userId,
    type: "settings",
    source: "Settings",
    icon: "zap",
    title,
    detail: list.length > 0 ? list.join("; ") : null,
  });
}

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
  /** Statute period (ADR-035): an amount + a unit, stored as-is and
   *  applied with calendar arithmetic. Both blank = "not configured".
   *  A positive whole number is required when the amount is present, and
   *  the unit must then be one of DAYS | MONTHS | YEARS. The action
   *  ignores both when hasStatuteOfLimitations isn't set. */
  statutePeriodAmount: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  statutePeriodUnit: z.enum(SOL_PERIOD_UNITS).optional().or(z.literal("")),
  /** Citation for the statute period — "C.R.S. § 13-80-102" etc.
   *  Surfaced on the SOL card so the lawyer can verify the firm's
   *  configuration against the actual statute. */
  statuteSourceCitation: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("")),
  /** Billing flow new matters in this area inherit on create. The
   *  edit form posts a string; we accept any value the enum knows
   *  about and fall back to "client" for stale forms posting an
   *  unknown value. */
  defaultBillingMode: z.enum(BILLING_MODES).optional(),
  /** Per-area matter-name template; blank = use the firm default. */
  matterNameTemplate: z.string().trim().max(300).optional().or(z.literal("")),
}).superRefine((v, ctx) => {
  if (v.hasStatuteOfLimitations !== "on") return;
  const raw = v.statutePeriodAmount ?? "";
  if (raw === "") return;
  if (!/^\d{1,4}$/.test(raw) || parseInt(raw, 10) < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["statutePeriodAmount"],
      message: "Enter a whole number of 1 or more",
    });
    return;
  }
  if (!v.statutePeriodUnit) {
    ctx.addIssue({
      code: "custom",
      path: ["statutePeriodUnit"],
      message: "Choose days, months or years",
    });
  }
});

/** Template + required-field validation shared by create and update.
 *  Returns field errors, or null when valid. */
function matterFieldErrors(
  template: string | undefined,
  required: string[]
): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};
  if (template) {
    const res = parseTemplate(template);
    if (!res.ok) errors.matterNameTemplate = [res.error];
  }
  const unknown = required.filter((k) => !isRequiredMatterField(k));
  if (unknown.length > 0) {
    errors.requiredMatterFields = unknown.map((k) => `Unknown field: ${k}`);
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

function describeRequired(keys: readonly string[]): string {
  return keys.length > 0 ? keys.join(", ") : "none";
}

/** Column pair for a period (both null when unconfigured). */
function periodColumns(period: SolPeriod | null) {
  return {
    statutePeriodAmount: period?.amount ?? null,
    statutePeriodUnit: period?.unit ?? null,
  };
}

/** The configured period from a parsed form, or null when blank. */
function periodFromForm(data: {
  statutePeriodAmount?: string;
  statutePeriodUnit?: string;
}): SolPeriod | null {
  const amount = parseInt(data.statutePeriodAmount ?? "", 10);
  return toSolPeriod(Number.isFinite(amount) ? amount : null, data.statutePeriodUnit);
}

/** Create a new practice area + auto-seed the default 10-stage
 *  lifecycle. Redirects to the detail page on success. */
export async function createPracticeArea(
  _prev: PracticeAreaFormState,
  formData: FormData
): Promise<PracticeAreaFormState> {
  const userId = await requirePermission("firm.manage_practice_areas");
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
  const requiredFields = [...new Set(formData.getAll("requiredMatterFields").map(String))];
  const matterErrors = matterFieldErrors(data.matterNameTemplate, requiredFields);
  if (matterErrors) {
    return { status: "error", errors: matterErrors, values: raw };
  }

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
      matterNameTemplate: data.matterNameTemplate || null,
      requiredMatterFields: requiredFields,
      hasStatuteOfLimitations: data.hasStatuteOfLimitations === "on",
      // SOL configuration — only stored when the area actually
      // tracks SOL. Stored as amount + unit (ADR-035); the legacy
      // statutePeriodDays column is no longer written.
      ...(data.hasStatuteOfLimitations === "on"
        ? periodColumns(periodFromForm(data))
        : periodColumns(null)),
      statuteSourceCitation:
        data.hasStatuteOfLimitations === "on"
          ? data.statuteSourceCitation || null
          : null,
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

  await logSettingsChange(userId, `Practice area created — ${data.name}`, [
    data.hasStatuteOfLimitations === "on" ? "SOL tracking on" : null,
  ]);

  revalidatePath("/", "layout");
  redirect(`/settings/practice-areas/${area.id}`);
}

export async function updatePracticeArea(
  id: string,
  _prev: PracticeAreaFormState,
  formData: FormData
): Promise<PracticeAreaFormState> {
  const userId = await requirePermission("firm.manage_practice_areas");
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
  // The form posts a hidden `requiredMatterFieldsPresent` marker so
  // "unchecked everything" (marker, no values) differs from "field absent"
  // (older callers): only the former changes the stored list.
  const requiredPosted = formData.get("requiredMatterFieldsPresent") !== null;
  const requiredFields = [...new Set(formData.getAll("requiredMatterFields").map(String))];
  const matterErrors = matterFieldErrors(data.matterNameTemplate, requiredFields);
  if (matterErrors) {
    return { status: "error", errors: matterErrors, values: raw };
  }

  const before = await prisma.practiceArea.findUnique({
    where: { id },
    select: {
      name: true,
      label: true,
      color: true,
      hasStatuteOfLimitations: true,
      statutePeriodAmount: true,
      statutePeriodUnit: true,
      statuteSourceCitation: true,
      defaultBillingMode: true,
      matterNameTemplate: true,
      requiredMatterFields: true,
    },
  });
  if (!before) {
    return {
      status: "error",
      errors: { name: ["Practice area not found"] },
      values: raw,
    };
  }

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

  const colorChanged =
    before.color.toLowerCase() !== data.color.toLowerCase();
  const updateArea = prisma.practiceArea.update({
    where: { id },
    data: {
      name: data.name,
      label: data.label || null,
      color: data.color,
      // A form that omits the field entirely leaves the template alone;
      // a present-but-blank one resets to the firm default.
      ...(data.matterNameTemplate !== undefined
        ? { matterNameTemplate: data.matterNameTemplate || null }
        : {}),
      ...(requiredPosted ? { requiredMatterFields: requiredFields } : {}),
      hasStatuteOfLimitations: data.hasStatuteOfLimitations === "on",
      // Turning SOL tracking OFF only stops auto-computing for future
      // use: the stored period + citation are kept (so re-enabling
      // restores them) and no matter's SOL date / SOL deadline is
      // touched. Only an enabled form overwrites them.
      ...(data.hasStatuteOfLimitations === "on"
        ? {
            ...periodColumns(periodFromForm(data)),
            statuteSourceCitation: data.statuteSourceCitation || null,
          }
        : {}),
      // Only write when the form actually posted a value — keeps
      // forward-compat with older forms that don't include the
      // select.
      ...(data.defaultBillingMode
        ? { defaultBillingMode: data.defaultBillingMode }
        : {}),
    },
  });
  // Matter.color is a snapshot of the area colour taken on create/edit.
  // Re-colour the matters still carrying the area's OLD colour so a
  // recolour reaches existing matters now rather than whenever each is
  // next edited; a matter whose colour differs (a per-matter override)
  // is left alone. Same transaction as the area write.
  let recoloredMatters = 0;
  if (colorChanged) {
    const [, recolored] = await prisma.$transaction([
      updateArea,
      prisma.matter.updateMany({
        where: {
          practiceAreaId: id,
          color: { equals: before.color, mode: "insensitive" },
        },
        data: { color: data.color },
      }),
    ]);
    recoloredMatters = recolored.count;
  } else {
    await updateArea;
  }

  const beforePeriod = toSolPeriod(
    before.statutePeriodAmount,
    before.statutePeriodUnit
  );
  const newPeriod =
    data.hasStatuteOfLimitations === "on"
      ? periodFromForm(data)
      : beforePeriod;
  const newCitation =
    data.hasStatuteOfLimitations === "on"
      ? data.statuteSourceCitation || null
      : before.statuteSourceCitation;
  await logSettingsChange(userId, `Practice area updated — ${data.name}`, [
    before.name !== data.name ? `name "${before.name}" → "${data.name}"` : null,
    (before.label ?? "") !== (data.label ?? "") ? "label" : null,
    colorChanged
      ? `color ${before.color} → ${data.color} (${recoloredMatters} matter${recoloredMatters === 1 ? "" : "s"} recoloured)`
      : null,
    before.hasStatuteOfLimitations !== (data.hasStatuteOfLimitations === "on")
      ? `SOL tracking ${before.hasStatuteOfLimitations ? "on" : "off"} → ${
          data.hasStatuteOfLimitations === "on" ? "on" : "off"
        }`
      : null,
    formatPeriodOrNone(beforePeriod) !== formatPeriodOrNone(newPeriod)
      ? `SOL period ${formatPeriodOrNone(beforePeriod)} → ${formatPeriodOrNone(newPeriod)}`
      : null,
    before.statuteSourceCitation !== newCitation ? "SOL citation" : null,
    data.defaultBillingMode &&
    before.defaultBillingMode !== data.defaultBillingMode
      ? `billing mode ${before.defaultBillingMode} → ${data.defaultBillingMode}`
      : null,
    data.matterNameTemplate !== undefined &&
    (before.matterNameTemplate ?? "") !== data.matterNameTemplate
      ? `Matter name template: "${before.matterNameTemplate ?? "firm default"}" → "${data.matterNameTemplate || "firm default"}"`
      : null,
    requiredPosted &&
    describeRequired(before.requiredMatterFields) !== describeRequired(requiredFields)
      ? `Required fields: ${describeRequired(before.requiredMatterFields)} → ${describeRequired(requiredFields)}`
      : null,
  ], true);

  revalidatePath("/", "layout");
  return { status: "ok", values: raw };
}

export async function setPracticeAreaActive(
  id: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("firm.manage_practice_areas");
  if (!isActive) {
    // Block archive while the area still owns any non-archived matter
    // (settled/closed ones included: the matter edit path rejects an
    // archived area, so they must be moved first). There is no
    // matter-archive control, so the message says "move", not "archive".
    const activeMatterCount = await prisma.matter.count({
      where: { practiceAreaId: id, isArchived: false },
    });
    if (activeMatterCount > 0) {
      return {
        ok: false,
        error: areaArchiveBlockedMessage(activeMatterCount),
      };
    }
  }
  const area = await prisma.practiceArea.update({
    where: { id },
    data: { isActive },
    select: { name: true },
  });
  await logSettingsChange(
    userId,
    `Practice area ${isActive ? "restored" : "archived"} — ${area.name}`,
    []
  );
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
  const row = await prisma.practiceArea.findUnique({
    where: { id },
    select: { isActive: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  // Archived rows are hidden in the UI and have no reorder controls.
  if (!row.isActive) return { ok: true };

  // Swap only among the VISIBLE (active) areas: swapping with a hidden
  // archived neighbour would leave the visible order unchanged and the
  // click would look broken. (order, id) keeps ties deterministic.
  const all = await prisma.practiceArea.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true, order: true },
  });
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return { ok: false, error: "Not found" };
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= all.length) return { ok: true };

  await prisma.$transaction(
    planReorder(all, idx, targetIdx).map((u) =>
      prisma.practiceArea.update({
        where: { id: u.id },
        data: { order: u.order },
      })
    )
  );

  // Pure reorders are deliberately NOT audited: every click would write a
  // "settings" row that floods the dashboard Recent activity feed.

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
  const userId = await requirePermission("firm.manage_practice_areas");
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

  await logSettingsChange(
    userId,
    `Stage created — ${parsed.data.name}`,
    [parsed.data.isTerminal === "on" ? "terminal stage" : null]
  );

  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function updateStage(
  stageId: string,
  _prev: StageFormState,
  formData: FormData
): Promise<StageFormState> {
  const userId = await requirePermission("firm.manage_practice_areas");
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
    select: { practiceAreaId: true, name: true, isTerminal: true },
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

  await logSettingsChange(userId, `Stage updated — ${parsed.data.name}`, [
    stage.name !== parsed.data.name
      ? `name "${stage.name}" → "${parsed.data.name}"`
      : null,
    stage.isTerminal !== (parsed.data.isTerminal === "on")
      ? `terminal ${stage.isTerminal ? "yes" : "no"} → ${
          parsed.data.isTerminal === "on" ? "yes" : "no"
        } (reclassifies matters as open/closed)`
      : null,
  ], true);

  revalidatePath("/", "layout");
  return { status: "ok", values: raw };
}

export async function setStageActive(
  stageId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("firm.manage_practice_areas");
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
  const stage = await prisma.matterStage.update({
    where: { id: stageId },
    data: { isActive },
    select: { name: true },
  });
  await logSettingsChange(
    userId,
    `Stage ${isActive ? "restored" : "archived"} — ${stage.name}`,
    []
  );
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
    select: {
      practiceAreaId: true,
      order: true,
      name: true,
      isActive: true,
    },
  });
  if (!stage) return { ok: false, error: "Stage not found" };
  if (!stage.isActive) return { ok: true };

  // Visible (active) siblings only — see movePracticeArea.
  const siblings = await prisma.matterStage.findMany({
    where: { practiceAreaId: stage.practiceAreaId, isActive: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true, order: true },
  });
  const idx = siblings.findIndex((s) => s.id === stageId);
  if (idx === -1) return { ok: false, error: "Stage not found" };
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings.length) return { ok: true };

  await prisma.$transaction(
    planReorder(siblings, idx, targetIdx).map((u) =>
      prisma.matterStage.update({
        where: { id: u.id },
        data: { order: u.order },
      })
    )
  );

  // Not audited — see movePracticeArea.

  revalidatePath("/", "layout");
  return { ok: true };
}
