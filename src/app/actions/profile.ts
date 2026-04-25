/**
 * Profile server action — current user edits their own row.
 *
 * Self-edit only. Email + role + isAdmin + isActive are deliberately
 * NOT writable here; those are identity / governance fields:
 *   - Email needs a re-verification flow (deferred — Phase 2 of
 *     AUTH_PLAN). For now an admin updates it via /settings/team
 *     (which doesn't expose email-edit yet either — same reason).
 *   - Role / isAdmin / isActive flow through admin governance on
 *     /settings/team so the firm has a single source of truth for
 *     who can do what.
 *
 * The action targets `getCurrentUserId()` directly, so there's no
 * way to write to another user's row from this path even if the
 * formData were tampered with. No auth bypass risk.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  profileInitialState,
  type ProfileFormState,
} from "@/lib/profile-form";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  initials: z
    .string()
    .trim()
    .min(1, "Initials are required")
    .max(3, "Initials should be 1–3 characters"),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  barNumber: z.string().trim().max(40).optional().or(z.literal("")),
  avatarUrl: z
    .string()
    .trim()
    .max(800)
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || /^https?:\/\//i.test(v),
      "Avatar URL must start with http:// or https://"
    ),
});

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  // No requireAdmin — every signed-in user can edit their own profile.
  // The id comes from the session, never from the form, so we can't
  // accidentally mutate another user.
  const userId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      name: parsed.data.name,
      initials: parsed.data.initials.toUpperCase(),
      phone: parsed.data.phone || null,
      barNumber: parsed.data.barNumber || null,
      avatarUrl: parsed.data.avatarUrl || null,
    },
  });

  revalidatePath("/settings/profile");
  // Sidebar reads from the User row (name, initials, role); bust the
  // layout cache so the change shows up everywhere immediately.
  revalidatePath("/", "layout");
  // Team page admin list also surfaces these fields.
  revalidatePath("/settings/team");
  return { ...profileInitialState, status: "ok" };
}
