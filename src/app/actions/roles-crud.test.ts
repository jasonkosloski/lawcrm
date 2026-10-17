/**
 * Integration tests for role CRUD guards (create / rename / delete).
 * The audit-log behaviour is covered in roles.test.ts; this file pins
 * the refusals:
 *
 *   - reserved names ("Admin", "default", any case) can't be created
 *     or renamed to;
 *   - system roles can't be renamed or deleted, whatever the input;
 *   - duplicate names are a friendly field error;
 *   - a role id from another firm is "not found" and untouched;
 *   - a caller without firm.manage_roles gets a `_form` error (the
 *     REAL resolver runs against the test DB) and nothing changes —
 *     no redirect, so the inline form can say why;
 *   - the permission toggle refuses unknown keys and reports a denial
 *     as a result the matrix can render.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createRoleAction,
  deleteRoleAction,
  setRolePermissionAction,
  updateRoleAction,
} from "@/app/actions/roles";
import { roleInitialState } from "@/lib/role-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;
let adminUserId: string;
let plainUserId: string;
let customRoleId: string;

const form = (name: string, description = "") => {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("description", description);
  return fd;
};

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
  adminUserId = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  plainUserId = (await seedUser({ firmId, roleIds: [defaultRoleId] })).userId;
  customRoleId = (
    await prisma.role.create({
      data: { firmId, name: "Paralegal", isSystem: false },
      select: { id: true },
    })
  ).id;
  mockedGetUser.mockResolvedValue(adminUserId);
});

describe("createRoleAction", () => {
  test.each(["Admin", "admin", "DEFAULT", "  default  "])(
    "refuses the reserved name %j",
    async (name) => {
      const res = await createRoleAction(roleInitialState, form(name));
      expect(res.status).toBe("error");
      expect(res.errors?.name?.[0]).toMatch(/Reserved/);
      expect(await prisma.role.count({ where: { firmId } })).toBe(3);
    }
  );

  test("refuses a duplicate name with a field error", async () => {
    const res = await createRoleAction(roleInitialState, form("Paralegal"));
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/already exists/);
    expect(await prisma.role.count({ where: { firmId, name: "Paralegal" } })).toBe(1);
  });

  test("a caller without firm.manage_roles gets a _form error and creates nothing", async () => {
    mockedGetUser.mockResolvedValue(plainUserId);
    const res = await createRoleAction(roleInitialState, form("Sneaky"));
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/permission/);
    expect(await prisma.role.count({ where: { name: "Sneaky" } })).toBe(0);
  });
});

describe("updateRoleAction", () => {
  test("refuses to rename a system role", async () => {
    const res = await updateRoleAction(
      adminRoleId,
      roleInitialState,
      form("Superuser")
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/System roles/);
    const row = await prisma.role.findUniqueOrThrow({ where: { id: adminRoleId } });
    expect(row.name).toBe("Admin");
  });

  test("refuses renaming a custom role to a reserved or taken name", async () => {
    await prisma.role.create({
      data: { firmId, name: "Billing", isSystem: false },
    });
    const reserved = await updateRoleAction(
      customRoleId,
      roleInitialState,
      form("Admin")
    );
    expect(reserved.errors?.name?.[0]).toMatch(/Reserved/);
    const dup = await updateRoleAction(
      customRoleId,
      roleInitialState,
      form("Billing")
    );
    expect(dup.errors?.name?.[0]).toMatch(/already exists/);
    const row = await prisma.role.findUniqueOrThrow({ where: { id: customRoleId } });
    expect(row.name).toBe("Paralegal");
  });

  test("a role id from another firm is 'not found' and untouched", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    const foreign = await prisma.role.create({
      data: { firmId: other.firmId, name: "Foreign", isSystem: false },
      select: { id: true },
    });
    const res = await updateRoleAction(
      foreign.id,
      roleInitialState,
      form("Renamed")
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/not found/i);
    const row = await prisma.role.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(row.name).toBe("Foreign");
  });
});

describe("deleteRoleAction", () => {
  test("refuses to delete a system role", async () => {
    const res = await deleteRoleAction(defaultRoleId);
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/System roles/);
    expect(await prisma.role.findUnique({ where: { id: defaultRoleId } })).not.toBeNull();
  });

  test("a role id from another firm is 'not found' and survives", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    const foreign = await prisma.role.create({
      data: { firmId: other.firmId, name: "Foreign", isSystem: false },
      select: { id: true },
    });
    const res = await deleteRoleAction(foreign.id);
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/not found/i);
    expect(await prisma.role.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  test("a caller without firm.manage_roles gets a _form error and deletes nothing", async () => {
    mockedGetUser.mockResolvedValue(plainUserId);
    const res = await deleteRoleAction(customRoleId);
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/permission/);
    expect(await prisma.role.findUnique({ where: { id: customRoleId } })).not.toBeNull();
  });
});

describe("setRolePermissionAction — gate and key validation", () => {
  test("a caller without firm.manage_permissions gets an error result, not a redirect", async () => {
    mockedGetUser.mockResolvedValue(plainUserId);
    const res = await setRolePermissionAction(customRoleId, "matters.create", true);
    expect(res).toEqual({
      ok: false,
      error: "You do not have permission to do that.",
    });
    expect(await prisma.rolePermission.count({ where: { roleId: customRoleId } })).toBe(0);
  });

  test("an unknown key is refused", async () => {
    const res = await setRolePermissionAction(customRoleId, "not.a.key", true);
    expect(res).toEqual({ ok: false, error: "Unknown permission key." });
  });

  test("a role id from another firm is 'not found'", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    const foreign = await prisma.role.create({
      data: { firmId: other.firmId, name: "Foreign", isSystem: false },
      select: { id: true },
    });
    const res = await setRolePermissionAction(foreign.id, "matters.create", true);
    expect(res.ok).toBe(false);
    expect(await prisma.rolePermission.count({ where: { roleId: foreign.id } })).toBe(0);
  });
});
