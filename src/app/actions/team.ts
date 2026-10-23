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
 *      deactivate, or reset sign-in links. Any write that would leave
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
 *      may not deactivate/reactivate, sign out, reset the sign-in
 *      link of, or re-invite a member who holds such a role (that
 *      would be account takeover or a denial-of-service lever); and
 *      may not edit an Admin's profile at all (name / initials / bar
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
 * role/status changes, and sign-in resets are governance actions a
 * firm must be able to retrace. matterId is always null: firm scope,
 * not matter scope.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import { parseBarAdmissions, replaceBarAdmissions } from "@/lib/bar-admissions";
import { logAuthEvent } from "@/lib/auth-events";
import {
  banStaff,
  revokeStaffInvitation,
  inviteStaff,
  revokeAllStaffSessions,
  unbanStaff,
} from "@/lib/clerk-admin";
import { ADMIN_ROLE_NAME, DEFAULT_ROLE_NAME, getCurrentFirm, isCurrentUserAdmin } from "@/lib/firm";
import { requirePermissionResult } from "@/lib/permission-check";
import { getPrivilegedRoleIds } from "@/lib/queries/team";
import { teamInitialState, type TeamFormState } from "@/lib/team-form";

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
  const defaultId = roles.find((r) => r.name === DEFAULT_ROLE_NAME)?.id ?? null;
  return { byId, adminId, defaultId };
}

/** Gate denial as form state — these actions are called from inline
 *  forms and menu items that render `_form`, so a denied caller sees
 *  why nothing happened instead of a silent bounce to the dashboard. */
function denied(error: string, values?: Record<string, string>): TeamFormState {
  return { status: "error", errors: { _form: [error] }, values };
}

const PRIVILEGED_ROLE_MESSAGE =
  "Only an Admin can grant or remove the Admin role, or roles that carry access-management permissions.";

const INVITE_WARNING = "Member added, but the invitation email didn't send. Use Resend invite.";
const BAN_WARNING =
  "Deactivated. They can't use the CRM, but the sign-in service didn't confirm signing them out. Use Sign out everywhere to retry.";
const UNBAN_WARNING =
  "Reactivated, but the sign-in service still blocks their sign-in. Deactivate and reactivate them to retry.";

const ADMIN_TARGET_MESSAGE = "Only an Admin can edit or deactivate an Admin.";

/** " — granted: A; revoked: B" for the audit detail (empty when the
 *  role set didn't change). */
function roleDiffSuffix(
  added: string[],
  removed: string[],
  byId: Map<string, { name: string }>,
): string {
  const names = (ids: string[]) =>
    ids
      .map((id) => byId.get(id)?.name ?? id)
      .sort()
      .join(", ");
  const parts: string[] = [];
  if (added.length) parts.push(`granted: ${names(added)}`);
  if (removed.length) parts.push(`revoked: ${names(removed)}`);
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

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
});

export async function inviteFirmMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const gate = await requirePermissionResult("firm.manage_team_directory");
  if (!gate.ok) return denied(gate.error);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  const admissions = parseBarAdmissions(formData.get("barAdmissions"));
  if (!admissions.ok) {
    return {
      status: "error",
      errors: { barAdmissions: [admissions.error] },
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
        isActive: true,
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
    if (admissions.value) await replaceBarAdmissions(tx, user.id, admissions.value);
  });

  // Audit trail — an invite grants roles; a firm needs to be able to
  // retrace who added whom with what access.
  const grantedRoleNames = [...validRoleIds].map((id) => roleMap.byId.get(id)?.name ?? id).sort();
  await logActivity({
    matterId: null,
    userId: currentUserId,
    type: "auth",
    title: `Invited ${parsed.data.name} to the firm`,
    detail:
      `${parsed.data.email} — roles: ${grantedRoleNames.join(", ")}` +
      (admissions.value?.length ? "; bar admissions added" : ""),
  });

  // Clerk emails the invitation. The row is already committed, so a
  // failure here is a warning (Resend invite), never a rollback.
  const sent = await inviteStaff(parsed.data.email);

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // member count + admin list
  revalidatePath("/settings/roles"); // member counts
  return {
    ...teamInitialState,
    status: "ok",
    warning: sent.ok ? undefined : INVITE_WARNING,
  };
}

// ── Update (name / initials / jobTitle / phone / roles / isActive)

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  initials: z
    .string()
    .trim()
    .min(1, "Initials are required")
    .max(3, "Initials should be 1–3 characters"),
  jobTitle: z.string().trim().min(1, "Pick a job title").max(60),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  isActive: z.literal("on").optional(),
});

export async function updateFirmMember(
  userId: string,
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const gate = await requirePermissionResult("firm.manage_team_directory");
  if (!gate.ok) return denied(gate.error);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  // Absent field = leave the admissions alone.
  const admissions = parseBarAdmissions(formData.get("barAdmissions"));
  if (!admissions.ok) {
    return {
      status: "error",
      errors: { barAdmissions: [admissions.error] },
      values: raw,
    };
  }

  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: {
      id: true,
      isActive: true,
      email: true,
      clerkUserId: true,
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
  const newIsActive = target.id === currentUserId ? target.isActive : parsed.data.isActive === "on";

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
      target.userRoles.map((ur) => ur.roleId).filter((id) => privileged.has(id)),
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

  const wasAdmin = target.userRoles.some((ur) => ur.role.name === ADMIN_ROLE_NAME);
  const willBeAdmin = roleMap.adminId ? validRoleIds.has(roleMap.adminId) : false;

  // "At least one Admin" invariant — losing the Admin role OR going
  // inactive while being the last admin is rejected.
  const wasAdminActive = wasAdmin && target.isActive;
  const willBeAdminActive = willBeAdmin && newIsActive;

  // Role changes actually applied (filled inside the transaction, from
  // the rows it read) — the audit entry lists them.
  let addedRoleIds: string[] = [];
  let removedRoleIds: string[] = [];
  let admissionsChanged = false;

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
            isActive: newIsActive,
          },
        });
        if (admissions.value) {
          admissionsChanged = await replaceBarAdmissions(tx, target.id, admissions.value);
        }
        // Apply only the DIFF: rewriting every row would stamp
        // assignedById / assignedAt of unchanged roles with whoever
        // last edited an unrelated field, erasing who really granted
        // (say) Admin. Current rows are re-read inside the
        // transaction so the diff matches what is actually stored.
        const currentIds = new Set(
          (
            await tx.userRole.findMany({
              where: { userId: target.id },
              select: { roleId: true },
            })
          ).map((r) => r.roleId),
        );
        removedRoleIds = [...currentIds].filter((id) => !validRoleIds.has(id));
        addedRoleIds = [...validRoleIds].filter((id) => !currentIds.has(id));
        if (removedRoleIds.length > 0) {
          await tx.userRole.deleteMany({
            where: { userId: target.id, roleId: { in: removedRoleIds } },
          });
        }
        if (addedRoleIds.length > 0) {
          await tx.userRole.createMany({
            data: addedRoleIds.map((roleId) => ({
              userId: target.id,
              roleId,
              assignedById: currentUserId,
            })),
            skipDuplicates: true,
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
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
  const roleNames = [...validRoleIds].map((id) => roleMap.byId.get(id)?.name ?? id).sort();
  await logActivity({
    matterId: null,
    userId: currentUserId,
    type: "auth",
    title: `Updated team member ${parsed.data.name}`,
    detail:
      `Roles: ${roleNames.join(", ")} — ${newIsActive ? "active" : "deactivated"}` +
      roleDiffSuffix(addedRoleIds, removedRoleIds, roleMap.byId) +
      (admissionsChanged ? "; bar admissions updated" : ""),
  });

  // Mirror the status change into Clerk AFTER the commit. The DB is
  // authoritative (resolveStaffUser denies an inactive user at once),
  // so a Clerk failure is a warning with a retry, not a rollback.
  let warning: string | undefined;
  if (target.clerkUserId && target.isActive !== newIsActive) {
    const deactivating = !newIsActive;
    const synced = deactivating
      ? await banStaff(target.clerkUserId)
      : await unbanStaff(target.clerkUserId);
    if (synced.ok) {
      await logAuthEvent({
        userId: target.id,
        kind: deactivating ? "clerk_banned" : "clerk_unbanned",
        reason: deactivating ? "deactivated from the team page" : "reactivated from the team page",
      });
    } else {
      warning = deactivating ? BAN_WARNING : UNBAN_WARNING;
    }
  } else if (!target.clerkUserId && target.isActive && !newIsActive) {
    // Never signed in: no Clerk user to ban, but a pending invitation
    // would still let them create a Clerk identity. Revoke it.
    const revoked = await revokeStaffInvitation(target.email);
    if (!revoked.ok) warning = BAN_WARNING;
  }

  revalidatePath("/settings/team");
  revalidatePath("/settings/firm"); // admin list might change
  revalidatePath("/settings/roles"); // member counts
  // Sidebar profile reads from the User row — bust layout cache.
  revalidatePath("/", "layout");
  return { ...teamInitialState, status: "ok", warning };
}

// ── Sign-in management (Clerk) ──────────────────────────────────────────

const SIGN_IN_TARGET_MESSAGE =
  "Only an Admin can manage sign-in for an Admin (or another access-management role holder).";

type SignInTarget = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  clerkUserId: string | null;
};

/** Shared gate for the sign-in actions: permission, same-firm lookup,
 *  and the Admin-class escalation guard. */
async function loadSignInTarget(
  userId: string,
): Promise<{ target: SignInTarget } | { error: TeamFormState }> {
  const gate = await requirePermissionResult("firm.manage_team_directory");
  if (!gate.ok) return { error: denied(gate.error) };
  const firm = await getCurrentFirm();
  const target = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      clerkUserId: true,
      userRoles: { select: { roleId: true } },
    },
  });
  if (!target) return { error: denied("User not found in this firm.") };

  // Signing someone out, resetting their link or re-inviting them is
  // account-takeover / lockout shaped for Admin-class accounts.
  if (!(await isCurrentUserAdmin())) {
    const privileged = await getPrivilegedRoleIds(firm.id);
    if (target.userRoles.some((ur) => privileged.has(ur.roleId))) {
      return { error: denied(SIGN_IN_TARGET_MESSAGE) };
    }
  }
  const { userRoles: _roles, ...rest } = target;
  void _roles;
  return { target: rest };
}

export async function resendFirmMemberInvite(userId: string): Promise<TeamFormState> {
  const loaded = await loadSignInTarget(userId);
  if ("error" in loaded) return loaded.error;
  const { target } = loaded;
  if (target.clerkUserId) {
    return denied("This member has already signed in.");
  }
  if (!target.isActive) {
    return denied("Reactivate this member before re-sending an invite.");
  }
  const sent = await inviteStaff(target.email);
  if (!sent.ok) return denied(sent.error);

  await logActivity({
    matterId: null,
    userId: await getCurrentUserId(),
    type: "auth",
    title: `Re-sent invitation to ${target.name}`,
    detail: target.email,
  });
  revalidatePath("/settings/team");
  return { ...teamInitialState, status: "ok" };
}

export async function signOutFirmMemberEverywhere(userId: string): Promise<TeamFormState> {
  const loaded = await loadSignInTarget(userId);
  if ("error" in loaded) return loaded.error;
  const { target } = loaded;
  if (!target.clerkUserId) {
    return denied("This member hasn't signed in yet — no sessions to end.");
  }
  const revoked = await revokeAllStaffSessions(target.clerkUserId);
  if (!revoked.ok) return denied(revoked.error);

  await logAuthEvent({
    userId: target.id,
    kind: "signed_out_everywhere",
    reason: "from the team page",
  });
  await logActivity({
    matterId: null,
    userId: await getCurrentUserId(),
    type: "auth",
    title: `Signed ${target.name} out everywhere`,
  });
  revalidatePath("/settings/team");
  return { ...teamInitialState, status: "ok" };
}

/**
 * Detach a member from their Clerk identity (e.g. they lost access to
 * the Google account). The old identity's sessions are revoked
 * first, and only then is the DB link cleared (otherwise a surviving
 * session would re-link itself). The member's next verified-email sign-in re-links.
 */
export async function resetFirmMemberSignInLink(userId: string): Promise<TeamFormState> {
  const loaded = await loadSignInTarget(userId);
  if ("error" in loaded) return loaded.error;
  const { target } = loaded;
  if (target.id === (await getCurrentUserId())) {
    return denied("You can't reset your own sign-in link.");
  }
  const oldClerkUserId = target.clerkUserId;
  if (!oldClerkUserId) {
    return denied("This member hasn't signed in yet — nothing to reset.");
  }

  // Revoke FIRST: if sessions survived a cleared link, the old
  // session's next request would re-link itself via the verified
  // email. Only clear the link once the old identity is signed out.
  const revoked = await revokeAllStaffSessions(oldClerkUserId);
  if (!revoked.ok) {
    return denied(
      "Couldn't sign them out of the sign-in service, so the link was not reset. Try again.",
    );
  }
  // Conditional on the id we read, so a concurrent re-link isn't wiped.
  await prisma.user.updateMany({
    where: { id: target.id, clerkUserId: oldClerkUserId },
    data: { clerkUserId: null },
  });

  await logAuthEvent({
    userId: target.id,
    kind: "sign_in_link_reset",
    reason: "from the team page",
  });
  await logActivity({
    matterId: null,
    userId: await getCurrentUserId(),
    type: "auth",
    title: `Reset sign-in link for ${target.name}`,
  });
  revalidatePath("/settings/team");
  return { ...teamInitialState, status: "ok" };
}
