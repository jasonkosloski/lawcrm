import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-check";
import { PERMISSION_CATEGORIES } from "@/lib/permissions";
import { resetDb, seedFirm, seedMatter, seedPracticeArea, seedUser } from "@/test/integration-helpers";
import { setPortalBilling } from "./portal-billing";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let adminRoleId: string;
let admin: string;
let matterId: string;

async function userWith(permissions: string[]) {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  for (const permission of permissions) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission } });
  }
  return (await seedUser({ firmId, name: "Staff", roleIds: [role.id] })).userId;
}

const flag = async () =>
  (await prisma.matter.findUniqueOrThrow({ where: { id: matterId }, select: { portalBillingEnabled: true } }))
    .portalBillingEnabled;
const activity = (title: string) =>
  prisma.activityLog.count({ where: { matterId, title } });

beforeEach(async () => {
  await resetDb();
  vi.mocked(revalidatePath).mockClear();
  ({ firmId, adminRoleId } = await seedFirm());
  admin = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  sessionUser = admin;
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: admin }));
});

describe("setPortalBilling", () => {
  test("the key is in the portal category", () => {
    const cat = PERMISSION_CATEGORIES.find((c) => c.id === "portal");
    expect(cat?.permissions.some((p) => p.key === "portal.share_billing")).toBe(true);
  });

  test("denied without portal.share_billing", async () => {
    sessionUser = await userWith(["billing.view"]);
    expect(await setPortalBilling(matterId, true)).toEqual({
      ok: false,
      error: PERMISSION_DENIED_MESSAGE,
    });
    expect(await flag()).toBe(false);
  });

  test("denied without billing.view", async () => {
    sessionUser = await userWith(["portal.share_billing"]);
    expect(await setPortalBilling(matterId, true)).toEqual({
      ok: false,
      error: PERMISSION_DENIED_MESSAGE,
    });
    expect(await flag()).toBe(false);
  });

  test("a walled user gets not-found and nothing changes", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.share_billing", "billing.view"]);
    await expect(setPortalBilling(matterId, true)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(await flag()).toBe(false);
  });

  test("turning on and off flips the column, logs, and revalidates", async () => {
    expect(await setPortalBilling(matterId, true)).toEqual({ ok: true });
    expect(await flag()).toBe(true);
    expect(await activity("Showed billing in the client portal")).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}`);

    expect(await setPortalBilling(matterId, false)).toEqual({ ok: true });
    expect(await flag()).toBe(false);
    expect(await activity("Hid billing from the client portal")).toBe(1);
  });

  test("no-op when unchanged writes no activity", async () => {
    expect(await setPortalBilling(matterId, false)).toEqual({ ok: true });
    expect(await prisma.activityLog.count({ where: { matterId } })).toBe(0);
    await setPortalBilling(matterId, true);
    await setPortalBilling(matterId, true);
    expect(await activity("Showed billing in the client portal")).toBe(1);
  });
});
