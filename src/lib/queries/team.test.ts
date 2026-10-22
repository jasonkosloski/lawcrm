/**
 * Integration tests for `listAssigneeOptions` — the option list
 * behind the task assignee pickers.
 *
 * Rules under test: active users only (inactive users keep old
 * assignments but can't receive new ones — mirrors the write-side
 * `isAssignableUser` check), scoped to the CURRENT user's firm,
 * name-ordered, compact shape (id / name / initials).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The query resolves the firm via getCurrentFirm → getCurrentUserId;
// stub the auth chain so @clerk/nextjs doesn't have to load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getPrivilegedRoleIds, listAssigneeOptions } from "@/lib/queries/team";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  const { userId } = await seedUser({
    firmId,
    name: "Zoe Viewer",
    initials: "ZV",
    email: "viewer@example.com",
  });
  mockedGetUser.mockResolvedValue(userId);
});

describe("listAssigneeOptions", () => {
  test("returns active firm users, name-ordered, compact shape", async () => {
    await seedUser({
      firmId,
      name: "Ada Lovelace",
      initials: "AL",
      email: "ada@example.com",
    });
    await seedUser({
      firmId,
      name: "Grace Hopper",
      initials: "GH",
      email: "grace@example.com",
    });

    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual(["Ada Lovelace", "Grace Hopper", "Zoe Viewer"]);
    expect(options[0]).toEqual(expect.objectContaining({ name: "Ada Lovelace", initials: "AL" }));
    expect(options[0]!.id).toBeTruthy();
  });

  test("excludes inactive users", async () => {
    await seedUser({
      firmId,
      name: "Gone Guy",
      email: "gone@example.com",
      isActive: false,
    });
    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual(["Zoe Viewer"]);
  });

  test("excludes users from other firms", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    await seedUser({
      firmId: other.firmId,
      name: "Alien Attorney",
      email: "alien@example.com",
    });
    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual(["Zoe Viewer"]);
  });
});

describe("getPrivilegedRoleIds", () => {
  test("returns Admin plus every role carrying an admin-only permission, scoped to the firm", async () => {
    const { adminRoleId, defaultRoleId } = await seedFirm({ name: "Priv Firm" });
    const firm = await prisma.firm.findFirstOrThrow({
      where: { name: "Priv Firm" },
      select: { id: true },
    });
    const accessManager = await prisma.role.create({
      data: {
        firmId: firm.id,
        name: "Access manager",
        isSystem: false,
        permissions: { create: { permission: "firm.manage_team_directory" } },
      },
      select: { id: true },
    });
    const billing = await prisma.role.create({
      data: {
        firmId: firm.id,
        name: "Billing",
        isSystem: false,
        permissions: { create: { permission: "billing.send_invoice" } },
      },
      select: { id: true },
    });
    // Another firm's Admin must not leak in.
    const other = await seedFirm({ name: "Other Firm" });

    const ids = await getPrivilegedRoleIds(firm.id);
    expect(ids.has(adminRoleId)).toBe(true);
    expect(ids.has(accessManager.id)).toBe(true);
    expect(ids.has(billing.id)).toBe(false);
    expect(ids.has(defaultRoleId)).toBe(false);
    expect(ids.has(other.adminRoleId)).toBe(false);
  });
});
