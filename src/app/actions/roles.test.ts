/**
 * Integration tests for `setRolePermissionAction` — the matrix
 * cell toggle. Focus is the escalation guard on the meta keys:
 *
 *   - A non-admin holder of firm.manage_permissions can toggle
 *     ordinary permissions (that's the whole point of delegation)…
 *   - …but cannot grant OR revoke firm.manage_permissions /
 *     firm.manage_roles on any role. Otherwise a delegate could
 *     mint admin-equivalent peer roles (or lock out other
 *     delegates) with no admin involvement.
 *   - An Admin can toggle the meta keys on non-system roles.
 *   - The Admin role's own column stays immutable for everyone.
 *
 * Permission resolution runs for real against the test DB — the
 * guard under test is exactly "who is the caller", so stubbing
 * permission-check would test nothing.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// `redirect` throws NEXT_REDIRECT internally; a recognisable stub
// lets a denied requirePermission surface as a catchable error.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { setRolePermissionAction } from "@/app/actions/roles";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let adminUserId: string;
/** Holds firm.manage_permissions via a custom role — NOT Admin. */
let delegateUserId: string;
/** The role being edited through the matrix. */
let targetRoleId: string;

const grantedKeys = async (roleId: string): Promise<string[]> => {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: true },
  });
  return rows.map((r) => r.permission);
};

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;

  const admin = await seedUser({ firmId, roleIds: [adminRoleId] });
  adminUserId = admin.userId;

  const delegateRole = await prisma.role.create({
    data: {
      firmId,
      name: "Permissions delegate",
      isSystem: false,
      permissions: { create: { permission: "firm.manage_permissions" } },
    },
    select: { id: true },
  });
  const delegate = await seedUser({ firmId, roleIds: [delegateRole.id] });
  delegateUserId = delegate.userId;

  const target = await prisma.role.create({
    data: { firmId, name: "Paralegal", isSystem: false },
    select: { id: true },
  });
  targetRoleId = target.id;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setRolePermissionAction — delegate (non-admin manage_permissions holder)", () => {
  beforeEach(() => {
    mockedGetUser.mockResolvedValue(delegateUserId);
  });

  test("can grant an ordinary permission", async () => {
    const res = await setRolePermissionAction(
      targetRoleId,
      "matters.create",
      true
    );
    expect(res.ok).toBe(true);
    expect(await grantedKeys(targetRoleId)).toContain("matters.create");
  });

  test("cannot grant firm.manage_permissions (escalation)", async () => {
    const res = await setRolePermissionAction(
      targetRoleId,
      "firm.manage_permissions",
      true
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Admin/);
    expect(await grantedKeys(targetRoleId)).not.toContain(
      "firm.manage_permissions"
    );
  });

  test("cannot revoke firm.manage_permissions from a peer role", async () => {
    await prisma.rolePermission.create({
      data: { roleId: targetRoleId, permission: "firm.manage_permissions" },
    });
    const res = await setRolePermissionAction(
      targetRoleId,
      "firm.manage_permissions",
      false
    );
    expect(res.ok).toBe(false);
    // Grant survives — the delegate can't lock out other delegates.
    expect(await grantedKeys(targetRoleId)).toContain(
      "firm.manage_permissions"
    );
  });

  test("cannot grant firm.manage_roles", async () => {
    const res = await setRolePermissionAction(
      targetRoleId,
      "firm.manage_roles",
      true
    );
    expect(res.ok).toBe(false);
    expect(await grantedKeys(targetRoleId)).not.toContain("firm.manage_roles");
  });
});

describe("setRolePermissionAction — admin caller", () => {
  beforeEach(() => {
    mockedGetUser.mockResolvedValue(adminUserId);
  });

  test("can grant firm.manage_permissions to a non-system role", async () => {
    const res = await setRolePermissionAction(
      targetRoleId,
      "firm.manage_permissions",
      true
    );
    expect(res.ok).toBe(true);
    expect(await grantedKeys(targetRoleId)).toContain(
      "firm.manage_permissions"
    );
  });

  test("still cannot mutate the Admin role's column", async () => {
    const res = await setRolePermissionAction(
      adminRoleId,
      "matters.create",
      true
    );
    expect(res.ok).toBe(false);
    expect(await grantedKeys(adminRoleId)).toEqual([]);
  });
});
