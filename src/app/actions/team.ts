/**
 * Team / firm-roster server actions.
 *
 * Every action is gated on `firm.manage_team_directory`; the read
 * view (the /settings/team page) is open to all firm members but
 * every write requires the permission (admin always has it,
 * other roles get it via the matrix). Invariants we enforce:
 *
 *   1. "At least one Admin" — a firm without an active user holding
 *      the Admin role can't change its own settings, invite,
 *      deactivate, or reset passwords. Any write that would leave
 *      zero active admins is rejected — and the count is re-checked
 *      INSIDE a Serializable transaction so two concurrent demotions
 *      can't both slip past a stale pre-check (check-then-act).
 *   2. "default role is always assigned" — every active user holds
 *      the firm's "default" role. The invite path adds it; the
 *      update path silently re-adds it if a form somehow drops it.
 *   3. "No deactivating yourself" — an admin who locks themselves
 *      out by mistake has no recovery path. Other admins can do it
 *      for them.
 *   4. "Email is unique" — duplicate-on-invite returns a friendly
 *      error rather than a Prisma constraint violation.
 *
 * Role membership replaces the old `User.isAdmin` boolean. The
 * multi-select on the team forms posts repeated `roleId=…` entries;
 * we read them as an array, normalize, intersect with the firm's
 * actual roles (defense against URL-tampering / stale options), and
 * replace-all the join rows.
 *
 * Every successful mutation writes an activity-log entry (see
 * roles.ts for the same treatment of permission flips) — invites,
 * role/status changes, and password resets are governance actions a
 * firm must be able to retrace. matterId is always null: firm scope,
 * not matter scope.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import {
  ADMIN_ROLE_NAME,
  DEFAULT_ROLE_NAME,
  getCurrentFirm,
} from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
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

/** Thrown inside the update transaction when the in-transaction
 *  admin recount says the write would leave zero active admins.
 *  Sole purpose is to roll the transaction back and be mapped to
 *  the friendly field error by the caller — never escapes the
 *  action. */
class LastActiveAdminError extends Error {
  constructor() {
    super("would leave the firm with no active Admin");
  }
}

/** Pull every `roleId` value from the form data — multi-select
 *  posts repeated keys with the same name. Filters out empties. */
function readRoleIds(formData: FormData): string[] {
  return formData
    .getAll("roleId")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Resolve the firm's role rows — used to (a) intersect submitted
 *  ids with the legitimate set and (b) find the Admin + default
 *  rows by name without an extra round-trip. */
async function getFirmRoleMap(firmId: string): Promise<{
  byId: Map<string, { id: string; name: string; isSystem: boolean }>;
  adminId: string | null;
  defaultId: string | null;
}> {
  const roles = await prisma.role.findMany({
    where: { firmId },
    select: { id: true, name: true, isSystem: true },
  });
  const byId = new Map(roles.map((r) => [r.id, r]));
  const adminId = roles.find((r) => r.name === ADMIN_ROLE_NAME)?.id ?? null;
  const defaultId =
    roles.find((r) => r.name === DEFAULT_ROLE_NAME)?.id ?? null;
  return { byId, adminId, defaultId };
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
  jobTitle: z.string().trim().min(1, "Pick a job title").max(60),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  barNumber: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function inviteFirmMember(
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  await requirePermission("firm.manage_team_directory");
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
  const roleMap = await getFirmRoleMap(firm.id);
  if (!roleMap.defaultId) {
    return {
      status: "error",
      errors: { _form: ["Firm is missing the system 'default' role — re-seed."] },
      values: raw,
    };
  }

  // Posted ids ∩ firm roles → set so dupes collapse. The default role
  // is always added (firm baseline); admins promoting at invite time
  // tick the Admin role explicitly.
  const requested = new Set(readRoleIds(formData));
  const validRoleIds = new Set<string>([roleMap.defaultId]);
  for (const id of requested) {
    if (roleMap.byId.has(id)) validRoleIds.add(id);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const currentUserId = await getCurrentUserId();

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firmId: firm.id,
        name: parsed.data.name,
        email: parsed.data.email,
        initials: parsed.data.initials.toUpperCase(),
        jobTitle: parsed.data.jobTitle,
        phone: parsed.data.phone || null,
        barNumber: parsed.data.barNumber || null,
        isActive: true,
        passwordHash,
      },
      select: { id: true },
    });
    await tx.userRole.createMany({
      data: [...validRoleIds].map((roleId) => ({
        userId: user.id,
        roleId,
        assignedById: currentUserId,
      })),
    });
  });

  // Audit trail — an invite mints credentials and grants roles in
  // one shot; a firm needs to be able to retrace who added whom
  // with what access. The temp password is deliberately NOT logged.
  const grantedRoleNames = [...validRoleIds]
    .map((id) => roleMap.byId.get(id)?.name ?? id)
    .sort();
  await logActivity({
    matterId: null,
    userId: currentUserId,
    type: "filing",
    title: `Invited ${parsed.data.name} to the firm`,
    detail: `${parsed.data.email} — roles: ${grantedRoleNames.join(", ")}`,
  });

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // member count + admin list
  revalidatePath("/settings/roles"); // member counts
  return {
    ...teamInitialState,
    status: "ok",
    invitePassword: tempPassword,
  };
}

// ── Update (name / initials / jobTitle / phone / barNumber / roles / isActive)

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  initials: z
    .string()
    .trim()
    .min(1, "Initials are required")
    .max(3, "Initials should be 1–3 characters"),
  jobTitle: z.string().trim().min(1, "Pick a job title").max(60),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  barNumber: z.string().trim().max(40).optional().or(z.literal("")),
  isActive: z.literal("on").optional(),
});

export async function updateFirmMember(
  userId: string,
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  await requirePermission("firm.manage_team_directory");
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
    select: {
      id: true,
      isActive: true,
      userRoles: { select: { roleId: true, role: { select: { name: true } } } },
    },
  });
  if (!target) {
    return {
      status: "error",
      errors: { name: ["User not found in this firm."] },
      values: raw,
    };
  }

  const currentUserId = await getCurrentUserId();
  // Self-protection: ignore whatever the form said about isActive
  // when editing yourself. Belt + suspenders — the form renders a
  // non-interactive indicator + hidden input so the value round-
  // trips, but a tampered post would otherwise hit the deactivate
  // path and trip the guard below.
  const newIsActive =
    target.id === currentUserId
      ? target.isActive
      : parsed.data.isActive === "on";

  // Self-protection check: redundant given the above, but kept as a
  // belt-and-suspenders guard in case the assignment above ever
  // changes. If you want out, another admin can do it for you.
  if (target.id === currentUserId && !newIsActive) {
    return {
      status: "error",
      errors: { isActive: ["You can't deactivate yourself."] },
      values: raw,
    };
  }

  // Resolve the firm's role universe + identify Admin / default rows.
  const roleMap = await getFirmRoleMap(firm.id);
  if (!roleMap.defaultId) {
    return {
      status: "error",
      errors: { _form: ["Firm is missing the system 'default' role — re-seed."] },
      values: raw,
    };
  }
  const requested = new Set(readRoleIds(formData));
  const validRoleIds = new Set<string>([roleMap.defaultId]);
  for (const id of requested) {
    if (roleMap.byId.has(id)) validRoleIds.add(id);
  }

  const wasAdmin = target.userRoles.some(
    (ur) => ur.role.name === ADMIN_ROLE_NAME
  );
  const willBeAdmin = roleMap.adminId
    ? validRoleIds.has(roleMap.adminId)
    : false;

  // "At least one Admin" invariant — losing the Admin role OR going
  // inactive while being the last admin is rejected.
  const wasAdminActive = wasAdmin && target.isActive;
  const willBeAdminActive = willBeAdmin && newIsActive;

  try {
    await prisma.$transaction(
      async (tx) => {
        // The admin count MUST be read inside the transaction, at
        // Serializable, or the invariant is a check-then-act race:
        // two requests each demoting one of the firm's two remaining
        // admins would both observe "2 remaining" against a stale
        // snapshot, both pass, and the firm would end with zero
        // active admins — unrecoverable, since every admin-gated
        // action then fails. Serializable makes the count + role
        // rewrite atomic; Postgres aborts one of two overlapping
        // demotions with a serialization failure (P2034) instead.
        if (wasAdminActive && !willBeAdminActive) {
          const remaining = await tx.user.count({
            where: {
              firmId: firm.id,
              isActive: true,
              userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
            },
          });
          // `remaining` still includes the target — the demotion is
          // written below, in this same transaction.
          if (remaining <= 1) throw new LastActiveAdminError();
        }

        await tx.user.update({
          where: { id: target.id },
          data: {
            name: parsed.data.name,
            initials: parsed.data.initials.toUpperCase(),
            jobTitle: parsed.data.jobTitle,
            phone: parsed.data.phone || null,
            barNumber: parsed.data.barNumber || null,
            isActive: newIsActive,
          },
        });
        // Replace-all on roles. Cheap (≤ a handful of rows per user) and
        // matches the mental model of the multi-select form.
        await tx.userRole.deleteMany({ where: { userId: target.id } });
        if (validRoleIds.size > 0) {
          await tx.userRole.createMany({
            data: [...validRoleIds].map((roleId) => ({
              userId: target.id,
              roleId,
              assignedById: currentUserId,
            })),
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof LastActiveAdminError) {
      return {
        status: "error",
        errors: {
          roleId: [
            "This is the firm's last active Admin — promote someone else before changing their roles or status.",
          ],
        },
        values: raw,
      };
    }
    // P2034 = serialization failure — a concurrent team edit raced
    // this one. Rare enough that "try again" beats an auto-retry
    // loop that would re-run the invariant check anyway.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      return {
        status: "error",
        errors: {
          _form: ["Another team change happened at the same time — try again."],
        },
        values: raw,
      };
    }
    throw err;
  }

  // Audit trail — role grants/revocations and (de)activation are at
  // least as sensitive as the permission-matrix flips roles.ts logs.
  const roleNames = [...validRoleIds]
    .map((id) => roleMap.byId.get(id)?.name ?? id)
    .sort();
  await logActivity({
    matterId: null,
    userId: currentUserId,
    type: "filing",
    title: `Updated team member ${parsed.data.name}`,
    detail: `Roles: ${roleNames.join(", ")} — ${newIsActive ? "active" : "deactivated"}`,
  });

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // admin list might change
  revalidatePath("/settings/roles"); // member counts
  // Sidebar profile reads from the User row — bust layout cache.
  revalidatePath("/", "layout");
  return { ...teamInitialState, status: "ok" };
}

// ── Reset password ──────────────────────────────────────────────────────

export async function resetFirmMemberPassword(
  userId: string
): Promise<TeamFormState> {
  await requirePermission("firm.manage_team_directory");
  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: { id: true, name: true },
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

  // Audit trail — this replaces someone else's credentials and hands
  // the temp password to the caller, which is account-takeover-shaped
  // if abused. "Who reset whose password when" must be answerable;
  // the temp password itself is deliberately NOT logged.
  const actorId = await getCurrentUserId();
  await logActivity({
    matterId: null,
    userId: actorId,
    type: "filing",
    title: `Reset password for ${target.name}`,
  });

  revalidatePath("/settings/team");
  return {
    ...teamInitialState,
    status: "ok",
    resetPassword: tempPassword,
  };
}
