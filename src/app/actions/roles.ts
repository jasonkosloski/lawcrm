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
import { requirePermission } from "@/lib/permission-check";
import { isKnownPermission, permissionLabel } from "@/lib/permissions";
import {
  roleInitialState,
  type RoleFormState,
} from "@/lib/role-form";

const RESERVED_NAMES = new Set(
  [ADMIN_ROLE_NAME, DEFAULT_ROLE_NAME].map((n) => n.toLowerCase())
);

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
  // who else can grant access. The matrix UI explicitly disables
  // the cell for `firm.manage_permissions` on non-Admin rows for
  // anyone who doesn't already have it (see PermissionsMatrix's
  // canEdit gate), so a non-admin holder can edit other rows but
  // not bootstrap themselves out of admin oversight.
  await requirePermission("firm.manage_permissions");
  if (!isKnownPermission(permission)) {
    return { ok: false, error: "Unknown permission key." };
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
