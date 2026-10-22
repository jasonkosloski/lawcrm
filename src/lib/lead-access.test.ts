/**
 * Integration tests for restricted-intake access (lead ethical walls,
 * ADR-049). Real Postgres: an open lead, a restricted lead with a
 * team, a non-member, a view_restricted holder, an Admin, an inactive
 * member.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  assertLeadAccess,
  canAccessLead,
  filterAccessibleLeadIds,
  leadAccessWhere,
  leadRelationAccessWhere,
} from "@/lib/lead-access";
import { resetDb, seedFirm, seedLead, seedUser } from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let alice: string; // on the restricted lead's team
let bob: string; // on nothing
let openLead: string;
let walled: string;

beforeEach(async () => {
  await resetDb();
  ({ firmId, adminRoleId } = await seedFirm());
  ({ userId: alice } = await seedUser({ firmId }));
  ({ userId: bob } = await seedUser({ firmId }));
  ({ leadId: openLead } = await seedLead({ name: "Open" }));
  ({ leadId: walled } = await seedLead({
    name: "Walled",
    restricted: true,
    teamUserIds: [alice],
  }));
  mockedUser.mockResolvedValue(bob);
});

describe("canAccessLead", () => {
  test("an open lead is visible to everyone", async () => {
    expect(await canAccessLead(bob, openLead)).toBe(true);
  });

  test("a restricted lead is visible to its team only", async () => {
    expect(await canAccessLead(alice, walled)).toBe(true);
    expect(await canAccessLead(bob, walled)).toBe(false);
  });

  test("a missing lead is not accessible", async () => {
    expect(await canAccessLead(alice, "missing")).toBe(false);
  });

  test("intake.view_restricted lifts the wall; other keys do not", async () => {
    const role = await prisma.role.create({ data: { firmId, name: "Intake lead" } });
    const { userId: carol } = await seedUser({ firmId, roleIds: [role.id] });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "matters.view_all" },
    });
    expect(await canAccessLead(carol, walled)).toBe(false);
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "intake.view_restricted" },
    });
    expect(await canAccessLead(carol, walled)).toBe(true);
  });

  test("Admin sees every restricted lead", async () => {
    const { userId: admin } = await seedUser({ firmId, roleIds: [adminRoleId] });
    expect(await canAccessLead(admin, walled)).toBe(true);
    expect(await leadAccessWhere(admin)).toEqual({});
  });

  test("an inactive team member sees nothing, open leads included", async () => {
    await prisma.user.update({ where: { id: alice }, data: { isActive: false } });
    expect(await canAccessLead(alice, walled)).toBe(false);
    expect(await canAccessLead(alice, openLead)).toBe(false);
  });
});

describe("where fragments", () => {
  test("leadAccessWhere lists open leads plus the user's restricted ones", async () => {
    const ids = async (uid: string) =>
      (
        await prisma.lead.findMany({
          where: await leadAccessWhere(uid),
          select: { id: true },
          orderBy: { name: "asc" },
        })
      ).map((r) => r.id);
    expect(await ids(bob)).toEqual([openLead]);
    expect(await ids(alice)).toEqual([openLead, walled]);
  });

  test("leadRelationAccessWhere wraps the clause for children", async () => {
    const frag = await leadRelationAccessWhere(bob);
    expect(frag.lead).toBeDefined();
    const notes = await prisma.note.findMany({
      where: { leadId: { not: null }, ...frag },
    });
    expect(notes).toHaveLength(0);
  });

  test("filterAccessibleLeadIds keeps only visible ids", async () => {
    expect([...(await filterAccessibleLeadIds(bob, [openLead, walled]))]).toEqual([openLead]);
    expect((await filterAccessibleLeadIds(alice, [walled])).size).toBe(1);
  });
});

describe("assertLeadAccess", () => {
  test("404s for hidden and missing leads, returns the user id otherwise", async () => {
    await expect(assertLeadAccess(openLead)).resolves.toBe(bob);
    await expect(assertLeadAccess(walled)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(assertLeadAccess("missing")).rejects.toThrow("NEXT_NOT_FOUND");
    mockedUser.mockResolvedValue(alice);
    await expect(assertLeadAccess(walled)).resolves.toBe(alice);
  });
});
