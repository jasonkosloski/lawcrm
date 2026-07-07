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
 * works as-is — `getCurrentFirm()` will read firmId off the JWT
 * instead of joining through the User row.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
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
   *  null out the date. Parsed by `parseLocalEstablishedAt` below —
   *  kept as a plain string here so a bad value surfaces as a field
   *  error, not a crash. */
  establishedAt: z.string().trim().optional().or(z.literal("")),
  /** Daily billable-hours target per person. 24 = hours in a day. */
  dailyHoursGoal: goalField("Daily hours goal", 24),
  /** Monthly firm-wide billable target. 744 = 31 days × 24h — a
   *  deliberately generous ceiling that still rejects fat-fingered
   *  values like 2000. */
  monthlyBillableGoal: goalField("Monthly billable goal", 744),
});

/** Parse the establishedAt field (`YYYY-MM-DD` from a
 *  `<input type="date">`) into local midnight of that day.
 *
 *  We don't use `new Date(value)` directly for two reasons: a
 *  tampered/malformed post (e.g. "abc") yields an Invalid Date that
 *  Prisma rejects with an unhandled 500 instead of a field error,
 *  and ISO date-only strings parse as UTC midnight, which renders a
 *  day early for any user west of UTC. Mirrors parseLocalDueDate
 *  (deadlines.ts) and parseEventBoundary (calendar-events.ts).
 *
 *  Returns null when the value can't be parsed (caller surfaces
 *  the field error). */
function parseLocalEstablishedAt(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function updateFirmAction(
  _prev: FirmFormState,
  formData: FormData
): Promise<FirmFormState> {
  // Auth gate — non-admins can't reach this even if they spoof a
  // Gated on `firm.edit_info`. Admin always has it; other roles
  // pick it up via the matrix.
  await requirePermission("firm.edit_info");

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

  // Validate the date before touching the DB — same friendly field
  // error the zod failures above get, instead of a Prisma 500.
  const establishedAt = data.establishedAt
    ? parseLocalEstablishedAt(data.establishedAt)
    : null;
  if (data.establishedAt && !establishedAt) {
    return {
      status: "error",
      errors: { establishedAt: ["Enter a valid date"] },
      values: raw,
    };
  }

  const firm = await getCurrentFirm();

  await prisma.firm.update({
    where: { id: firm.id },
    data: {
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
      establishedAt,
      // Safe Number() — the goalField regex admits only \d+(\.\d)?
      dailyHoursGoal: Number(data.dailyHoursGoal),
      monthlyBillableGoal: Number(data.monthlyBillableGoal),
    },
  });

  revalidatePath("/settings/firm");
  // Layout-level revalidate — firm name might surface in the topbar
  // or sidebar branding once we wire it.
  revalidatePath("/", "layout");
  return { ...firmInitialState, status: "ok" };
}
