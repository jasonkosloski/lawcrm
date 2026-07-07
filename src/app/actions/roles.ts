/**
 * Role server actions — admin-gated CRUD for firm-scoped roles.
 *
 * Two reserved names — "Admin" and "default" — match the seeded
 * system roles. Neither is allowed in `createRole` (case-insensitive
 * check) and neither can be renamed or deleted via `updateRole` /
 * `deleteRole` regardless of the action input. The schema's
 * `isSystem` flag is the source of truth; the action just refuses
 * to touch a row where it's set.
 *
 * Role assignment lives in `team.ts` (invite / update member) since
 * roles are an attribute of users.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import {
  ADMIN_ROLE_NAME,
  DEFAULT_ROLE_NAME,
  getCurrentFirm,
} from "@/lib/firm";
import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/permission-check";
import { isKnownPermission, permissionLabel } from "@/lib/permissions";
import {
  roleInitialState,
  type RoleFormState,
} from "@/lib/role-form";

const RESERVED_NAMES = new Set(
  [ADMIN_ROLE_NAME, DEFAULT_ROLE_NAME].map((n) => n.toLowerCase())
);

// The "meta" permissions govern access to access itself. Only an
// Admin may grant or revoke them — otherwise any manage_permissions
// holder could mint admin-equivalent peers (grant a role
// manage_permissions plus everything else) with no admin
// involvement. manage_roles rides along because renaming/deleting
// roles is how you'd dismantle the delegation structure an admin
// set up.
const ADMIN_ONLY_PERMISSIONS = new Set([
  "firm.manage_permissions",
  "firm.manage_roles",
]);

const roleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Role name is required")
    .max(60)
    // Disallow leading/trailing whitespace + names that look like
    // system roles ("admin" matches "Admin" too).
    .refine(
      (v) => !RESERVED_NAMES.has(v.toLowerCase()),
      'Reserved name — "Admin" and "default" are managed by the system.'
    ),
  description: z.string().trim().max(400).optional().or(z.literal("")),
});

// ── Create ──────────────────────────────────────────────────────────────

export async function createRoleAction(
  _prev: RoleFormState,
  formData: FormData
): Promise<RoleFormState> {
  await requirePermission("firm.manage_roles");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = roleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  const firm = await getCurrentFirm();

  // Friendly duplicate-name guard so the unique index doesn't throw
  // an opaque Prisma error.
  const dup = await prisma.role.findUnique({
    where: {
      firmId_name: { firmId: firm.id, name: parsed.data.name },
    },
    select: { id: true },
  });
  if (dup) {
    return {
      status: "error",
      errors: { name: ["A role with that name already exists."] },
      values: raw,
    };
  }

  await prisma.role.create({
    data: {
      firmId: firm.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      isSystem: false,
    },
  });

  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ...roleInitialState, status: "ok" };
}

// ── Update (rename + description) ──────────────────────────────────────

export async function updateRoleAction(
  roleId: string,
  _prev: RoleFormState,
  formData: FormData
): Promise<RoleFormState> {
  await requirePermission("firm.manage_roles");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = roleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const firm = await getCurrentFirm();
  const target = await prisma.role.findFirst({
    where: { id: roleId, firmId: firm.id },
    select: { id: true, isSystem: true, name: true },
  });
  if (!target) {
    return {
      status: "error",
      errors: { name: ["Role not found in this firm."] },
      values: raw,
    };
  }
  if (target.isSystem) {
    return {
      status: "error",
      errors: { name: ["System roles can't be renamed."] },
      values: raw,
    };
  }

  // Unique-name pre-check (skip when the name didn't change).
  if (parsed.data.name !== target.name) {
    const dup = await prisma.role.findUnique({
      where: {
        firmId_name: { firmId: firm.id, name: parsed.data.name },
      },
      select: { id: true },
    });
    if (dup) {
      return {
        status: "error",
        errors: { name: ["A role with that name already exists."] },
        values: raw,
      };
    }
  }

  await prisma.role.update({
    where: { id: target.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
    },
  });

  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ...roleInitialState, status: "ok" };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteRoleAction(
  roleId: string
): Promise<RoleFormState> {
  await requirePermission("firm.manage_roles");
  const firm = await getCurrentFirm();
  const target = await prisma.role.findFirst({
    where: { id: roleId, firmId: firm.id },
    select: { id: true, isSystem: true, name: true },
  });
  if (!target) {
    return {
      status: "error",
      errors: { _form: ["Role not found in this firm."] },
    };
  }
  if (target.isSystem) {
    return {
      status: "error",
      errors: { _form: ["System roles can't be deleted."] },
    };
  }
  // Cascade on UserRole removes assignments automatically.
  await prisma.role.delete({ where: { id: target.id } });

  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ...roleInitialState, status: "ok" };
}

// ── Toggle a single role/permission cell ──────────────────────────────
//
// The matrix UI calls this on every checkbox click. Idempotent:
// granting an already-granted permission is a no-op (and ditto for
// revoke). Refuses to mutate the Admin role — admin grants every
// permission implicitly via the runtime check, so the matrix shows
// it as locked and the action wouldn't have anywhere to write.

export async function setRolePermissionAction(
  roleId: string,
  permission: string,
  granted: boolean
): Promise<{ ok: boolean; error?: string }> {
  // Distinct permission from manage_roles — granting permissions
  // is a higher-trust act than naming roles, since it controls
  // who else can grant access. A non-admin holder can edit other
  // rows freely, but the meta keys (ADMIN_ONLY_PERMISSIONS) are
  // guarded below so they can't bootstrap themselves — or a peer
  // role — out of admin oversight.
  await requirePermission("firm.manage_permissions");
  if (!isKnownPermission(permission)) {
    return { ok: false, error: "Unknown permission key." };
  }
  // Server-side escalation guard: don't trust the matrix UI to hide
  // these cells — a tampered request must hit the same wall. Both
  // grant AND revoke are admin-only: revoking manage_permissions
  // from a peer role is how a rogue delegate would lock out the
  // other delegates.
  if (ADMIN_ONLY_PERMISSIONS.has(permission)) {
    const { isAdmin } = await getCurrentUserPermissions();
    if (!isAdmin) {
      return {
        ok: false,
        error: "Only an Admin can change who holds this permission.",
      };
    }
  }

  const firm = await getCurrentFirm();
  const target = await prisma.role.findFirst({
    where: { id: roleId, firmId: firm.id },
    select: { id: true, isSystem: true, name: true },
  });
  if (!target) return { ok: false, error: "Role not found in this firm." };
  // Admin is implicitly all-granted at the runtime check, so its
  // matrix column is read-only. Refuse mutations explicitly so a
  // tampered request can't leak rows.
  if (target.isSystem && target.name === ADMIN_ROLE_NAME) {
    return {
      ok: false,
      error: "Admin grants every permission by definition — can't change it.",
    };
  }

  // Detect no-op writes so we don't log "granted" entries for a
  // permission that was already granted (or "revoked" for one that
  // wasn't held). The matrix UI is optimistic so duplicate clicks
  // are common.
  const existing = await prisma.rolePermission.findUnique({
    where: { roleId_permission: { roleId: target.id, permission } },
    select: { roleId: true },
  });
  const wasGranted = existing !== null;
  const isNoOp = granted === wasGranted;

  if (granted) {
    await prisma.rolePermission.upsert({
      where: { roleId_permission: { roleId: target.id, permission } },
      create: { roleId: target.id, permission },
      update: {},
    });
  } else {
    // Use deleteMany so revoking a not-currently-granted row is
    // a no-op rather than a P2025 throw.
    await prisma.rolePermission.deleteMany({
      where: { roleId: target.id, permission },
    });
  }

  // Audit trail. Permission changes are higher-trust than most
  // mutations — capturing who flipped which cell against which
  // role is exactly what a firm needs to retrace if something
  // gets misconfigured. matterId=null because this is firm-scope
  // governance, not matter-scoped activity.
  if (!isNoOp) {
    const actorId = await getCurrentUserId();
    await logActivity({
      matterId: null,
      userId: actorId,
      type: "filing",
      title: granted
        ? `Granted "${permissionLabel(permission)}" to ${target.name}`
        : `Revoked "${permissionLabel(permission)}" from ${target.name}`,
      detail: permission,
    });
  }

  revalidatePath("/settings/roles");
  revalidatePath("/settings/team");
  return { ok: true };
}
