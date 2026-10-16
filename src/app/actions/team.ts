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
 *   5. "Only an Admin hands out Admin" — `firm.manage_team_directory`
 *      is delegable (e.g. to an office manager) but must not be an
 *      escalation path. A non-Admin caller may not grant or remove
 *      the Admin role, or any role carrying an ADMIN_ONLY permission
 *      (src/lib/permissions.ts), on anyone — themselves included;
 *      may not deactivate/reactivate, or reset the password of, a
 *      member who holds such a role (that would be account takeover);
 *      may not unlock their sign-in (each unlock grants fresh
 *      password guesses against the highest-value accounts); and may
 *      not edit an Admin's profile at all (name / initials / bar
 *      number changes are an impersonation and audit-confusion
 *      vector). Enforced here, server-side — the UI hiding the checkbox is
 *      convenience only.
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
import { recordAuthEvent } from "@/lib/auth-events";
import {
  ADMIN_ROLE_NAME,
  DEFAULT_ROLE_NAME,
  getCurrentFirm,
  isCurrentUserAdmin,
} from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import { ADMIN_ONLY_PERMISSIONS } from "@/lib/permissions";
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

/** Roles only an Admin may hand out or take away: Admin itself and
 *  any role carrying an ADMIN_ONLY permission (manage_permissions /
 *  manage_roles / manage_team_directory). */
async function getPrivilegedRoleIds(firmId: string): Promise<Set<string>> {
  const rows = await prisma.role.findMany({
    where: {
      firmId,
      OR: [
        { name: ADMIN_ROLE_NAME },
        {
          permissions: {
            some: { permission: { in: [...ADMIN_ONLY_PERMISSIONS] } },
          },
        },
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

const PRIVILEGED_ROLE_MESSAGE =
  "Only an Admin can grant or remove the Admin role, or roles that carry access-management permissions.";

const ADMIN_TARGET_MESSAGE =
  "Only an Admin can edit or deactivate an Admin.";

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
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

  // Escalation guard: only an Admin may mint an Admin (or another
  // access-management role holder).
  if (!(await isCurrentUserAdmin())) {
    const privileged = await getPrivilegedRoleIds(firm.id);
    if ([...validRoleIds].some((id) => privileged.has(id))) {
      return {
        status: "error",
        errors: { roleId: [PRIVILEGED_ROLE_MESSAGE] },
        values: raw,
      };
    }
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
    type: "auth",
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

  // Escalation guard (see invariant 5 in the header). A non-Admin
  // may not touch an Admin's record at all; for holders of other
  // privileged roles (e.g. an access manager editing themselves) the
  // privileged-role sets are compared, so any change in privileged
  // membership (grant to self/anyone, or revoke) is refused.
  if (!(await isCurrentUserAdmin())) {
    if (target.userRoles.some((ur) => ur.role.name === ADMIN_ROLE_NAME)) {
      return {
        status: "error",
        errors: { _form: [ADMIN_TARGET_MESSAGE] },
        values: raw,
      };
    }
    const privileged = await getPrivilegedRoleIds(firm.id);
    const held = new Set(
      target.userRoles.map((ur) => ur.roleId).filter((id) => privileged.has(id))
    );
    const wanted = new Set([...validRoleIds].filter((id) => privileged.has(id)));
    if (!sameSet(held, wanted)) {
      return {
        status: "error",
        errors: { roleId: [PRIVILEGED_ROLE_MESSAGE] },
        values: raw,
      };
    }
    if (held.size > 0 && newIsActive !== target.isActive) {
      return {
        status: "error",
        errors: {
          isActive: [
            "Only an Admin can deactivate or reactivate an Admin (or another access-management role holder).",
          ],
        },
        values: raw,
      };
    }
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
    type: "auth",
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
    select: { id: true, name: true, userRoles: { select: { roleId: true } } },
  });
  if (!target) {
    return {
      status: "error",
      errors: { _form: ["User not found in this firm."] },
    };
  }

  // Resetting a password hands the caller a working login for that
  // account — for an Admin (or an access-management role holder)
  // that is a full takeover, so it is Admin-only.
  if (!(await isCurrentUserAdmin())) {
    const privileged = await getPrivilegedRoleIds(firm.id);
    if (target.userRoles.some((ur) => privileged.has(ur.roleId))) {
      return {
        status: "error",
        errors: {
          _form: [
            "Only an Admin can reset the password of an Admin (or another access-management role holder).",
          ],
        },
      };
    }
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  // A reset also lifts any sign-in lockout (src/lib/credentials-
  // authorize.ts): otherwise an attacker who deliberately failed
  // logins to lock the account would still have the user locked out
  // of the brand-new password. The unlock row is written in the same
  // transaction as the new hash, so a failed audit write can't leave
  // a reset that reports ok while the account is still locked.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash },
    });
    await recordAuthEvent(
      {
        userId: target.id,
        kind: "sign_in_unlocked",
        reason: "password reset by an administrator",
      },
      tx
    );
  });

  // Audit trail — this replaces someone else's credentials and hands
  // the temp password to the caller, which is account-takeover-shaped
  // if abused. "Who reset whose password when" must be answerable;
  // the temp password itself is deliberately NOT logged.
  const actorId = await getCurrentUserId();
  await logActivity({
    matterId: null,
    userId: actorId,
    type: "auth",
    title: `Reset password for ${target.name}`,
  });

  revalidatePath("/settings/team");
  return {
    ...teamInitialState,
    status: "ok",
    resetPassword: tempPassword,
  };
}

// ── Unlock sign-in ──────────────────────────────────────────────────────

/**
 * Clear a member's sign-in lockout immediately (5 failed sign-ins in
 * 15 minutes pause the account — and anyone who knows a staff email
 * can trigger that on purpose). Writes a `sign_in_unlocked` auth
 * event, which the lockout counter treats like a successful sign-in,
 * plus an actor-attributed activity entry.
 */
export async function unlockFirmMemberSignIn(
  userId: string
): Promise<TeamFormState> {
  await requirePermission("firm.manage_team_directory");
  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: { id: true, name: true, userRoles: { select: { roleId: true } } },
  });
  if (!target) {
    return {
      status: "error",
      errors: { _form: ["User not found in this firm."] },
    };
  }

  // Each unlock resets the failure count, i.e. grants fresh password
  // guesses. A delegate must not be able to keep an Admin's throttle
  // open on demand, so Admin-class targets are Admin-only (same rule
  // as resetFirmMemberPassword).
  if (!(await isCurrentUserAdmin())) {
    const privileged = await getPrivilegedRoleIds(firm.id);
    if (target.userRoles.some((ur) => privileged.has(ur.roleId))) {
      return {
        status: "error",
        errors: {
          _form: [
            "Only an Admin can unlock sign-in for an Admin (or another access-management role holder).",
          ],
        },
      };
    }
  }

  // The unlock row IS the effect: write it with the throwing variant
  // so a failed write surfaces as an error instead of a false "ok"
  // on a still-locked account.
  try {
    await recordAuthEvent({
      userId: target.id,
      kind: "sign_in_unlocked",
      reason: "unlocked from the team page",
    });
  } catch (err) {
    console.error("[team] failed to record sign-in unlock", err);
    return {
      status: "error",
      errors: { _form: ["Couldn't unlock sign-in — try again."] },
    };
  }
  const actorId = await getCurrentUserId();
  await logActivity({
    matterId: null,
    userId: actorId,
    type: "auth",
    title: `Unlocked sign-in for ${target.name}`,
  });

  revalidatePath("/settings/team");
  return { ...teamInitialState, status: "ok" };
}
