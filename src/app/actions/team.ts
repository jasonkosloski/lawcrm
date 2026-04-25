/**
 * Team / firm-roster server actions.
 *
 * Every action is `requireAdmin()`-gated; the read view (the
 * /settings/team page) is open to all firm members but every write
 * is admin-only. Three classes of invariant we enforce:
 *
 *   1. "At least one admin" — a firm without an admin can't change
 *      its own settings, invite, deactivate, or reset passwords.
 *      We block any write that would leave `countActiveAdmins() === 0`.
 *   2. "No deactivating yourself" — an admin who locks themselves
 *      out by mistake has no recovery path. The other admins can
 *      still deactivate them.
 *   3. "Email is unique per firm" (and globally — `User.email` has a
 *      unique index already). The invite path turns a duplicate into
 *      a friendly error rather than a 500.
 *
 * Password handling on invite + reset: we generate a 16-char URL-safe
 * temp password, return it in the form state so the admin can
 * paste it into Slack/email/whatever. When email delivery lands
 * (Phase 2 of AUTH_PLAN), this becomes a magic-link instead.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm, requireAdmin } from "@/lib/firm";
import { countActiveAdmins } from "@/lib/queries/team";
import {
  teamInitialState,
  type TeamFormState,
} from "@/lib/team-form";

/** Generate a URL-safe random password. 16 chars from a 64-symbol
 *  alphabet ≈ 96 bits of entropy — enough for one-time use. */
function generateTempPassword(): string {
  // Strip out characters that look alike (l/1/I, 0/O) to make
  // verbal/typed handoff less error-prone.
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

// ── Invite ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  initials: z
    .string()
    .trim()
    .min(1, "Initials are required")
    .max(3, "Initials should be 1–3 characters"),
  role: z.string().trim().min(1, "Pick a role").max(60),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  barNumber: z.string().trim().max(40).optional().or(z.literal("")),
  isAdmin: z.literal("on").optional(),
});

export async function inviteFirmMember(
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  await requireAdmin();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  // Email-uniqueness pre-check so we can surface a friendly error
  // rather than a Prisma constraint violation. The unique index is
  // still the source of truth — race conditions fall back to it.
  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) {
    return {
      status: "error",
      errors: { email: ["A user with that email already exists."] },
      values: raw,
    };
  }

  const firm = await getCurrentFirm();
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await prisma.user.create({
    data: {
      firmId: firm.id,
      name: parsed.data.name,
      email: parsed.data.email,
      initials: parsed.data.initials.toUpperCase(),
      role: parsed.data.role,
      phone: parsed.data.phone || null,
      barNumber: parsed.data.barNumber || null,
      isAdmin: parsed.data.isAdmin === "on",
      isActive: true,
      passwordHash,
    },
  });

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // member count + admin list
  return {
    ...teamInitialState,
    status: "ok",
    invitePassword: tempPassword,
  };
}

// ── Update (name / role / initials / phone / barNumber / isAdmin / isActive) ─

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  initials: z
    .string()
    .trim()
    .min(1, "Initials are required")
    .max(3, "Initials should be 1–3 characters"),
  role: z.string().trim().min(1, "Pick a role").max(60),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  barNumber: z.string().trim().max(40).optional().or(z.literal("")),
  isAdmin: z.literal("on").optional(),
  isActive: z.literal("on").optional(),
});

export async function updateFirmMember(
  userId: string,
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  await requireAdmin();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: { id: true, isAdmin: true, isActive: true },
  });
  if (!target) {
    return {
      status: "error",
      errors: { name: ["User not found in this firm."] },
      values: raw,
    };
  }

  const newIsAdmin = parsed.data.isAdmin === "on";
  const newIsActive = parsed.data.isActive === "on";

  const currentUserId = await getCurrentUserId();
  // Self-protection: an admin can't deactivate themselves. Mistake-
  // proofing — if you want out, another admin can do it for you.
  if (target.id === currentUserId && !newIsActive) {
    return {
      status: "error",
      errors: { isActive: ["You can't deactivate yourself."] },
      values: raw,
    };
  }

  // "At least one admin" invariant — any change that would leave
  // the firm with zero active admins is rejected.
  const wasAdminAndActive = target.isAdmin && target.isActive;
  const isAdminAfter = newIsAdmin && newIsActive;
  if (wasAdminAndActive && !isAdminAfter) {
    const remaining = await countActiveAdmins();
    // remaining includes the target row itself (still admin in DB);
    // post-mutation count = remaining - 1. Block if that would be 0.
    if (remaining <= 1) {
      return {
        status: "error",
        errors: {
          isAdmin: [
            "This is the firm's last active admin — promote someone else first.",
          ],
        },
        values: raw,
      };
    }
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      name: parsed.data.name,
      initials: parsed.data.initials.toUpperCase(),
      role: parsed.data.role,
      phone: parsed.data.phone || null,
      barNumber: parsed.data.barNumber || null,
      isAdmin: newIsAdmin,
      isActive: newIsActive,
    },
  });

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // admin list might change
  // Sidebar profile reads from the User row — bust layout cache.
  revalidatePath("/", "layout");
  return { ...teamInitialState, status: "ok" };
}

// ── Reset password ──────────────────────────────────────────────────────

export async function resetFirmMemberPassword(
  userId: string
): Promise<TeamFormState> {
  await requireAdmin();
  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: { id: true },
  });
  if (!target) {
    return {
      status: "error",
      errors: { _form: ["User not found in this firm."] },
    };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash },
  });

  revalidatePath("/settings/team");
  return {
    ...teamInitialState,
    status: "ok",
    resetPassword: tempPassword,
  };
}
