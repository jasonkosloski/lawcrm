/**
 * Integration tests for `requirePermission` and friends against
 * the real test DB.
 *
 * Coverage:
 *   - Admin role short-circuits to all-granted.
 *   - RolePermission rows on a non-admin role grant access.
 *   - Multiple roles → union of grants.
 *   - Inactive users get nothing (even with admin role).
 *   - `requirePermission(...)` throws (redirect) when missing.
 *   - `currentUserHasAnyPermission([...])` matches the doc.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// `next/navigation`'s redirect throws an internal NEXT_REDIRECT
// error in production. In tests we want to detect the call —
// keep a stub that throws a recognisable string we can catch.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  currentUserHasAnyPermission,
  currentUserHasPermission,
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/permission-check";
import {
  resetDb,
  seedFirm,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;
let customRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
  // A custom role with one explicit grant — for testing
  // RolePermission-driven access.
  const billing = await prisma.role.create({
    data: {
      firmId,
      name: "Billing manager",
      isSystem: false,
    },
    select: { id: true },
  });
  customRoleId = billing.id;
  await prisma.rolePermission.create({
    data: {
      roleId: customRoleId,
      permission: "billing.send_invoice",
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Admin role short-circuits to all-granted", () => {
  test("admin holds every catalog permission via the wildcard path", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);

    expect(await currentUserHasPermission("matters.manage_team")).toBe(true);
    expect(await currentUserHasPermission("billing.send_invoice")).toBe(true);
    expect(await currentUserHasPermission("firm.manage_permissions")).toBe(
      true
    );
  });

  test("admin's resolved permissions surface isAdmin=true", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);

    const { isAdmin } = await getCurrentUserPermissions();
    expect(isAdmin).toBe(true);
  });

  test("requirePermission resolves quietly for admins", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);
    const result = await requirePermission("matters.delete");
    expect(result).toBe(userId);
  });
});

describe("Non-admin grants flow through RolePermission rows", () => {
  test("user holding a role with a grant has the keyed permission", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [defaultRoleId, customRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);

    expect(await currentUserHasPermission("billing.send_invoice")).toBe(true);
  });

  test("user without the granting role does NOT have the permission", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [defaultRoleId], // no customRoleId
    });
    mockedGetUser.mockResolvedValue(userId);

    expect(await currentUserHasPermission("billing.send_invoice")).toBe(false);
  });

  test("permissions are unioned across multiple roles", async () => {
    // Add a second custom role with a different grant.
    const intake = await prisma.role.create({
      data: { firmId, name: "Intake paralegal", isSystem: false },
      select: { id: true },
    });
    await prisma.rolePermission.create({
      data: {
        roleId: intake.id,
        permission: "intake.conflict_check.run",
      },
    });
    const { userId } = await seedUser({
      firmId,
      roleIds: [customRoleId, intake.id],
    });
    mockedGetUser.mockResolvedValue(userId);

    // Holds keys from BOTH roles.
    expect(await currentUserHasPermission("billing.send_invoice")).toBe(true);
    expect(await currentUserHasPermission("intake.conflict_check.run")).toBe(
      true
    );
    // Doesn't hold keys from neither.
    expect(await currentUserHasPermission("matters.delete")).toBe(false);
  });
});

describe("Inactive users", () => {
  test("inactive user (even with Admin role) gets no permissions", async () => {
    const { userId } = await seedUser({
      firmId,
      isActive: false,
      roleIds: [adminRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);

    expect(await currentUserHasPermission("matters.manage_team")).toBe(false);
    const { isAdmin, granted } = await getCurrentUserPermissions();
    expect(isAdmin).toBe(false);
    expect(granted.size).toBe(0);
  });
});

describe("requirePermission — redirect on miss", () => {
  test("throws (redirect) when the user lacks the key", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);

    // The mocked redirect throws `__REDIRECT__:/` — assert the
    // shape rather than a specific error class.
    await expect(
      requirePermission("matters.delete")
    ).rejects.toThrow(/__REDIRECT__:\//);
  });

  test("returns the userId when the key is held", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [customRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);

    const out = await requirePermission("billing.send_invoice");
    expect(out).toBe(userId);
  });
});

describe("currentUserHasAnyPermission", () => {
  test("returns true when at least one key is held", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [customRoleId], // grants billing.send_invoice
    });
    mockedGetUser.mockResolvedValue(userId);

    const out = await currentUserHasAnyPermission([
      "matters.delete",
      "billing.send_invoice",
      "firm.edit_info",
    ]);
    expect(out).toBe(true);
  });

  test("returns false when none of the keys are held", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [defaultRoleId] });
    mockedGetUser.mockResolvedValue(userId);

    const out = await currentUserHasAnyPermission([
      "matters.delete",
      "firm.manage_roles",
    ]);
    expect(out).toBe(false);
  });

  test("admin gets true for any non-empty list", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);

    expect(
      await currentUserHasAnyPermission(["this.does.not.exist"])
    ).toBe(true);
  });
});
