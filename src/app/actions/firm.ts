/**
 * Firm profile server action.
 *
 * Single update path for the firm record — name, contact info,
 * address, EIN, website, established date, productivity goals
 * (daily hours / monthly billable targets). Gated on
 * `firm.edit_info` via `requirePermission(...)` (admin role
 * short-circuits to all granted), so the action is safe to expose
 * to any UI.
 *
 * Multi-tenant note: scopes the update by firmId resolved from the
 * current user's session. When we go multi-tenant, the same code
 * works as-is — `getCurrentFirm()` will read firmId off the resolved staff session
 * instead of joining through the User row.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadCurrentFirm, loadFirmGoals } from "@/lib/firm";
import { logActivity } from "@/lib/activity-log";
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import { parseTemplate } from "@/lib/matter-name-template";
import { requirePermissionResult } from "@/lib/permission-check";
import {
  firmInitialState,
  type FirmFormState,
} from "@/lib/firm-form";

/** Goal fields arrive as strings from `<input type="number">`.
 *  Validated here (not just by the input's min/max — those are
 *  advisory client-side) as: a plain positive number with at most
 *  ONE decimal place, within a sane ceiling. One decimal matches
 *  how the goals render everywhere (`toFixed(1)`), so what the
 *  admin types is exactly what the dashboard shows. */
const goalField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(
      (v) => /^\d+(\.\d)?$/.test(v),
      `${label} must be a number with at most one decimal place`
    )
    .refine((v) => Number(v) > 0, `${label} must be greater than zero`)
    .refine((v) => Number(v) <= max, `${label} can't exceed ${max}`);

const firmSchema = z.object({
  name: z.string().trim().min(1, "Firm name is required").max(200),
  shortName: z.string().trim().max(120).optional().or(z.literal("")),
  ein: z.string().trim().max(40).optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .max(400)
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || /^https?:\/\//i.test(v),
      "Website must start with http:// or https://"
    ),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || v.includes("@"), "That doesn't look like an email"),
  addressLine1: z.string().trim().max(200).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(60).optional().or(z.literal("")),
  zip: z.string().trim().max(20).optional().or(z.literal("")),
  country: z.string().trim().min(1).max(60).default("US"),
  /** ISO date string from a `<input type="date">`. Empty string =
   *  null out the date. Parsed with `parseDateOnly` in the action —
   *  kept as a plain string here so a bad value surfaces as a field
   *  error, not a crash. */
  establishedAt: z.string().trim().optional().or(z.literal("")),
  /** Daily billable-hours target per person. 24 = hours in a day. */
  dailyHoursGoal: goalField("Daily hours goal", 24),
  /** Monthly firm-wide billable target. 744 = 31 days × 24h — a
   *  deliberately generous ceiling that still rejects fat-fingered
   *  values like 2000. */
  monthlyBillableGoal: goalField("Monthly billable goal", 744),
  /** Firm-default matter-name template. Omitted entirely = leave the
   *  current value alone; present but blank = error. */
  matterNameTemplate: z
    .string()
    .trim()
    .min(1, "A default template is required.")
    .max(300)
    .optional(),
});

/** Profile columns whose change is recorded (by NAME only — values
 *  such as the EIN never reach the activity log). */
const PROFILE_FIELDS = [
  "name",
  "shortName",
  "ein",
  "website",
  "phone",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zip",
  "country",
] as const;

export async function updateFirmAction(
  _prev: FirmFormState,
  formData: FormData
): Promise<FirmFormState> {
  // Gated on `firm.edit_info`. Admin always has it; other roles
  // pick it up via the matrix. A denial comes back as a form error
  // (the form renders `_form`), not a silent redirect.
  const gate = await requirePermissionResult("firm.edit_info");
  if (!gate.ok) {
    return { status: "error", errors: { _form: [gate.error] } };
  }

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = firmSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const data = parsed.data;

  if (data.matterNameTemplate !== undefined) {
    const t = parseTemplate(data.matterNameTemplate);
    if (!t.ok) {
      return {
        status: "error",
        errors: { matterNameTemplate: [t.error] },
        values: raw,
      };
    }
  }

  // Validate the date before touching the DB — same friendly field
  // error the zod failures above get, instead of a Prisma 500.
  // Date-only value: stored at UTC midnight (ADR-012), no zone.
  const establishedAt = data.establishedAt
    ? parseDateOnly(data.establishedAt)
    : null;
  if (data.establishedAt && !establishedAt) {
    return {
      status: "error",
      errors: { establishedAt: ["Enter a valid date"] },
      values: raw,
    };
  }

  // Fresh (uncached) reads: the page re-renders after this action and
  // must not see the pre-edit row through a request-level cache.
  const [firm, oldGoals] = await Promise.all([
    loadCurrentFirm(),
    loadFirmGoals(),
  ]);

  const next = {
    name: data.name,
    shortName: data.shortName || null,
    ein: data.ein || null,
    website: data.website || null,
    phone: data.phone || null,
    email: data.email || null,
    addressLine1: data.addressLine1 || null,
    addressLine2: data.addressLine2 || null,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    country: data.country,
  };

  const oldTemplate =
    data.matterNameTemplate !== undefined
      ? (
          await prisma.firm.findUnique({
            where: { id: firm.id },
            select: { matterNameTemplate: true },
          })
        )?.matterNameTemplate
      : undefined;

  await prisma.firm.update({
    where: { id: firm.id },
    data: {
      ...next,
      ...(data.matterNameTemplate !== undefined
        ? { matterNameTemplate: data.matterNameTemplate }
        : {}),
      establishedAt,
      // Safe Number() — the goalField regex admits only \d+(\.\d)?
      dailyHoursGoal: Number(data.dailyHoursGoal),
      monthlyBillableGoal: Number(data.monthlyBillableGoal),
    },
  });

  // Audit trail: which fields changed (names only — never the EIN or
  // any other value), plus old -> new for the numeric goals.
  const changed: string[] = PROFILE_FIELDS.filter(
    (f) => (firm[f] ?? null) !== next[f]
  );
  if (
    data.matterNameTemplate !== undefined &&
    oldTemplate !== data.matterNameTemplate
  ) {
    changed.push(
      `matterNameTemplate ("${oldTemplate ?? ""}" -> "${data.matterNameTemplate}")`
    );
  }
  const oldKey = firm.establishedAt ? dateOnlyKey(firm.establishedAt) : null;
  const newKey = establishedAt ? dateOnlyKey(establishedAt) : null;
  if (oldKey !== newKey) changed.push("establishedAt");
  const newDaily = Number(data.dailyHoursGoal);
  const newMonthly = Number(data.monthlyBillableGoal);
  if (newDaily !== oldGoals.dailyHoursGoal) {
    changed.push(`dailyHoursGoal (${oldGoals.dailyHoursGoal} -> ${newDaily})`);
  }
  if (newMonthly !== oldGoals.monthlyBillableGoal) {
    changed.push(
      `monthlyBillableGoal (${oldGoals.monthlyBillableGoal} -> ${newMonthly})`
    );
  }
  if (changed.length > 0) {
    await logActivity({
      matterId: null,
      userId: gate.userId,
      type: "auth",
      title: "Updated firm profile",
      detail: `Changed: ${changed.join(", ")}`,
    });
  }

  revalidatePath("/settings/firm");
  // Layout-level revalidate — firm name might surface in the topbar
  // or sidebar branding once we wire it.
  revalidatePath("/", "layout");
  return { ...firmInitialState, status: "ok" };
}

/** Master switch for the client portal. Gated on `firm.edit_info`. */
export async function setPortalEnabled(
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePermissionResult("firm.edit_info");
  if (!gate.ok) return { ok: false, error: gate.error };

  const user = await prisma.user.findUnique({
    where: { id: gate.userId },
    select: { firmId: true },
  });
  if (!user?.firmId) return { ok: false, error: "Firm not found." };

  // Off also ends every client session (single-tenant: all of them), so
  // turning it back on later does not resurrect old sign-ins.
  await prisma.$transaction([
    prisma.firm.update({
      where: { id: user.firmId },
      data: { portalEnabled: enabled },
    }),
    ...(enabled ? [] : [prisma.portalSession.deleteMany({})]),
  ]);
  await logActivity({
    matterId: null,
    userId: gate.userId,
    type: "auth",
    title: enabled ? "Turned the client portal on" : "Turned the client portal off",
  });
  revalidatePath("/settings/firm");
  return { ok: true };
}
