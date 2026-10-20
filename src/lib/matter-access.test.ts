/**
 * Integration tests for matter-team access (ethical walls).
 * Real Postgres: two users, TEAM vs FIRM mode, a view_all holder, an
 * Admin, a removed member, an archived matter, inactive user.
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
  assertChildMatterAccess,
  assertMatterAccess,
  assertOptionalMatterAccess,
  canAccessMatter,
  filterAccessibleMatterIds,
  matterAccessWhere,
  matterIdOfChild,
  matterRelationAccessWhere,
  optionalMatterAccessWhere,
  optionalRecordAccessClause,
  leadIdOfChild,
} from "@/lib/matter-access";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedTimeEntry,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;
let alice: string; // on matter A (lead)
let bob: string; // on nothing
let matterA: string;
let matterB: string; // lead = bob

async function setMode(mode: "FIRM" | "TEAM") {
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: mode },
  });
}

beforeEach(async () => {
  await resetDb();
  ({ firmId, adminRoleId, defaultRoleId } = await seedFirm());
  ({ userId: alice } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  ({ userId: bob } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId: matterA } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: alice,
    name: "Matter A",
  }));
  const carol = (await seedUser({ firmId })).userId;
  ({ matterId: matterB } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: carol,
    name: "Matter B",
  }));
  mockedUser.mockResolvedValue(alice);
});

describe("FIRM mode (default)", () => {
  test("everyone sees every matter", async () => {
    expect(await canAccessMatter(bob, matterA)).toBe(true);
    expect(await matterAccessWhere(bob)).toEqual({});
  });

  test("an unknown matter is still not accessible", async () => {
    expect(await canAccessMatter(bob, "nope")).toBe(false);
  });
});

describe("TEAM mode", () => {
  beforeEach(() => setMode("TEAM"));

  test("members see their matter, non-members do not", async () => {
    expect(await canAccessMatter(alice, matterA)).toBe(true);
    expect(await canAccessMatter(bob, matterA)).toBe(false);
    expect(await canAccessMatter(alice, matterB)).toBe(false);
  });

  test("matterAccessWhere lists only the user's matters", async () => {
    const where = await matterAccessWhere(alice);
    const rows = await prisma.matter.findMany({ where, select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([matterA]);
    expect(
      await prisma.matter.findMany({ where: await matterAccessWhere(bob) })
    ).toHaveLength(0);
  });

  test("a removed member loses access", async () => {
    await prisma.matterTeamMember.update({
      where: { matterId_userId: { matterId: matterA, userId: alice } },
      data: { removedAt: new Date() },
    });
    expect(await canAccessMatter(alice, matterA)).toBe(false);
  });

  test("an archived matter is still accessible to its team", async () => {
    await prisma.matter.update({
      where: { id: matterA },
      data: { isArchived: true },
    });
    expect(await canAccessMatter(alice, matterA)).toBe(true);
    expect(await canAccessMatter(bob, matterA)).toBe(false);
  });

  test("Admin sees everything", async () => {
    const { userId: admin } = await seedUser({ firmId, roleIds: [adminRoleId] });
    expect(await canAccessMatter(admin, matterA)).toBe(true);
    expect(await matterAccessWhere(admin)).toEqual({});
  });

  test("a matters.view_all role grants everything; other keys do not", async () => {
    const role = await prisma.role.create({
      data: { firmId, name: "Office Manager" },
    });
    const { userId: om } = await seedUser({ firmId, roleIds: [role.id] });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "matters.edit" },
    });
    expect(await canAccessMatter(om, matterA)).toBe(false);
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "matters.view_all" },
    });
    // New request scope: the per-request cache is keyed per test run
    // only where React cache() is active; query directly.
    expect(await canAccessMatter(om, matterA)).toBe(true);
  });

  test("an inactive user sees nothing, even in FIRM mode", async () => {
    const { userId: gone } = await seedUser({ firmId, isActive: false });
    expect(await canAccessMatter(gone, matterA)).toBe(false);
    await setMode("FIRM");
    expect(await canAccessMatter(gone, matterA)).toBe(false);
  });

  test("assertMatterAccess 404s for hidden, passes for visible", async () => {
    await expect(assertMatterAccess(matterA)).resolves.toBe(alice);
    await expect(assertMatterAccess(matterB)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(assertMatterAccess("missing")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("assertOptionalMatterAccess passes a null matter", async () => {
    await expect(assertOptionalMatterAccess(null)).resolves.toBe(alice);
    await expect(assertOptionalMatterAccess(matterB)).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });

  test("relation fragments wrap the matter clause", async () => {
    expect(await matterRelationAccessWhere(alice)).toEqual({
      matter: { teamMembers: { some: { userId: alice, removedAt: null } } },
    });
    const opt = await optionalMatterAccessWhere(alice);
    expect(opt.OR?.[0]).toEqual({ matterId: null });
  });

  test("filterAccessibleMatterIds keeps only visible ids", async () => {
    const ids = await filterAccessibleMatterIds(alice, [matterA, matterB]);
    expect([...ids]).toEqual([matterA]);
    expect((await filterAccessibleMatterIds(bob, [matterA])).size).toBe(0);
  });

  test("child resolution: a note on a hidden matter 404s; unmatter'd rows pass", async () => {
    const note = await prisma.note.create({
      data: {
        matterId: matterB,
        authorId: alice,
        content: "secret",
      },
    });
    expect(await matterIdOfChild("note", note.id)).toBe(matterB);
    await expect(assertChildMatterAccess("note", note.id)).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(await matterIdOfChild("note", "missing")).toBeUndefined();
    await expect(assertChildMatterAccess("note", "missing")).resolves.toBeNull();
    const task = await prisma.task.create({
      data: { title: "firm-wide" },
    });
    expect(await matterIdOfChild("task", task.id)).toBeNull();
    await expect(assertChildMatterAccess("task", task.id)).resolves.toBeNull();
  });
});

describe("restricted matters (ADR-049)", () => {
  beforeEach(async () => {
    await prisma.matter.update({
      where: { id: matterA },
      data: { restricted: true },
    });
  });

  test("FIRM mode: a restricted matter is team-only", async () => {
    expect(await canAccessMatter(alice, matterA)).toBe(true);
    expect(await canAccessMatter(bob, matterA)).toBe(false);
    expect(await canAccessMatter(bob, matterB)).toBe(true);
    const rows = await prisma.matter.findMany({
      where: await matterAccessWhere(bob),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toEqual([matterB]);
  });

  test("FIRM mode: matters.view_all and Admin still see it", async () => {
    const role = await prisma.role.create({ data: { firmId, name: "Billing" } });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "matters.view_all" },
    });
    const { userId: billing } = await seedUser({ firmId, roleIds: [role.id] });
    const { userId: admin } = await seedUser({ firmId, roleIds: [adminRoleId] });
    expect(await canAccessMatter(billing, matterA)).toBe(true);
    expect(await canAccessMatter(admin, matterA)).toBe(true);
    expect(await matterAccessWhere(billing)).toEqual({});
  });

  test("FIRM mode: a removed member of a restricted matter loses access", async () => {
    await prisma.matterTeamMember.update({
      where: { matterId_userId: { matterId: matterA, userId: alice } },
      data: { removedAt: new Date() },
    });
    expect(await canAccessMatter(alice, matterA)).toBe(false);
  });

  test("TEAM mode: the flag changes nothing", async () => {
    await setMode("TEAM");
    expect(await canAccessMatter(alice, matterA)).toBe(true);
    expect(await canAccessMatter(bob, matterA)).toBe(false);
    expect(await canAccessMatter(bob, matterB)).toBe(false);
  });

  test("filterAccessibleMatterIds honours the flag", async () => {
    expect([...(await filterAccessibleMatterIds(bob, [matterA, matterB]))]).toEqual([
      matterB,
    ]);
  });
});

describe("lead-scoped children (ADR-049)", () => {
  let walled: string;
  let open: string;

  beforeEach(async () => {
    ({ leadId: walled } = await seedLead({
      name: "Walled",
      restricted: true,
      teamUserIds: [alice],
    }));
    ({ leadId: open } = await seedLead({ name: "Open" }));
    mockedUser.mockResolvedValue(bob);
  });

  test("by-id children of a restricted lead 404 for a non-member", async () => {
    const note = await prisma.note.create({
      data: { leadId: walled, authorId: alice, content: "x" },
    });
    const task = await prisma.task.create({ data: { title: "t", leadId: walled } });
    const event = await prisma.calendarEvent.create({
      data: {
        title: "consult",
        leadId: walled,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600_000),
        createdById: alice,
      },
    });
    const { timeEntryId } = await seedTimeEntry({ leadId: walled, userId: alice });
    const doc = await prisma.document.create({
      data: { leadId: walled, name: "secret.pdf", category: "other" },
    });
    const cases = [
      ["note", note.id],
      ["task", task.id],
      ["calendarEvent", event.id],
      ["timeEntry", timeEntryId],
      ["document", doc.id],
    ] as const;
    for (const [kind, id] of cases) {
      expect(await leadIdOfChild(kind, id)).toBe(walled);
      await expect(assertChildMatterAccess(kind, id)).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
    }
    mockedUser.mockResolvedValue(alice);
    for (const [kind, id] of cases) {
      await expect(assertChildMatterAccess(kind, id)).resolves.toBeNull();
    }
  });

  test("children of an open lead pass", async () => {
    const note = await prisma.note.create({
      data: { leadId: open, authorId: alice, content: "x" },
    });
    await expect(assertChildMatterAccess("note", note.id)).resolves.toBeNull();
  });

  test("optionalRecordAccessClause hides restricted-lead rows, keeps firm-wide ones", async () => {
    await prisma.task.createMany({
      data: [
        { title: "walled", leadId: walled },
        { title: "open", leadId: open },
        { title: "firm" },
        { title: "matter", matterId: matterA },
      ],
    });
    const titles = async (uid: string) =>
      (
        await prisma.task.findMany({
          where: { AND: await optionalRecordAccessClause(uid) },
          select: { title: true },
          orderBy: { title: "asc" },
        })
      ).map((t) => t.title);
    expect(await titles(bob)).toEqual(["firm", "matter", "open"]);
    expect(await titles(alice)).toEqual(["firm", "matter", "open", "walled"]);
    await setMode("TEAM");
    expect(await titles(bob)).toEqual(["firm", "open"]);
  });

  test("optionalRecordAccessClause needs BOTH scopes when a row has both (ActivityLog)", async () => {
    // A conversion audit row sits on the matter and names the lead.
    await prisma.matter.update({ where: { id: matterA }, data: { restricted: true } });
    await prisma.activityLog.createMany({
      data: [
        { matterId: matterA, leadId: open, userId: alice, type: "filing", title: "both" },
        { matterId: matterB, leadId: walled, userId: alice, type: "filing", title: "walled lead" },
        { matterId: matterB, leadId: open, userId: alice, type: "filing", title: "visible" },
      ],
    });
    const titles = async (uid: string) =>
      (
        await prisma.activityLog.findMany({
          where: { AND: await optionalRecordAccessClause(uid) },
          select: { title: true },
          orderBy: { title: "asc" },
        })
      ).map((t) => t.title);
    // bob is on neither matter A's team nor the walled lead's.
    expect(await titles(bob)).toEqual(["visible"]);
    expect(await titles(alice)).toEqual(["both", "visible", "walled lead"]);
  });

  test("optionalRecordAccessClause is empty for an unrestricted viewer", async () => {
    const { userId: admin } = await seedUser({ firmId, roleIds: [adminRoleId] });
    expect(await optionalRecordAccessClause(admin)).toEqual([]);
  });
});
