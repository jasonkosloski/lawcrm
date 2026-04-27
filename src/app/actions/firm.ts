/**
 * Firm profile server action.
 *
 * Single update path for the firm record — name, contact info,
 * address, EIN, website, established date. `requireAdmin()` runs
 * before any write, so the action is safe to expose to any UI.
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
   *  null out the date. */
  establishedAt: z.string().trim().optional().or(z.literal("")),
});

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

  const firm = await getCurrentFirm();
  const data = parsed.data;

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
      establishedAt: data.establishedAt ? new Date(data.establishedAt) : null,
    },
  });

  revalidatePath("/settings/firm");
  // Layout-level revalidate — firm name might surface in the topbar
  // or sidebar branding once we wire it.
  revalidatePath("/", "layout");
  return { ...firmInitialState, status: "ok" };
}
