/**
 * Integration tests: the Settings -> Firm matter-visibility switch is
 * Admin-only, validates input, writes the firm column and an
 * activity-log entry, and is a no-op when nothing changes. Also
 * covers the thin-teams list that backs the rollout checklist.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
import { updateMatterVisibilityAction } from "@/app/actions/matter-visibility";
import { classifyTeam, listThinTeams } from "@/lib/queries/thin-teams";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);
const idle = { status: "idle" as const };

function form(v: string) {
  const fd = new FormData();
  fd.set("matterVisibility", v);
  return fd;
}

let firmId: string;
let admin: string;
let member: string;
let areaId: string;
let stageId: string;

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  admin = (await seedUser({ firmId, roleIds: [f.adminRoleId] })).userId;
  member = (await seedUser({ firmId, roleIds: [f.defaultRoleId] })).userId;
  ({ areaId, stageId } = await seedPracticeArea());
  mockedUser.mockResolvedValue(admin);
});

describe("updateMatterVisibilityAction", () => {
  test("admin flips to TEAM and it is logged", async () => {
    const r = await updateMatterVisibilityAction(idle, form("TEAM"));
    expect(r.status).toBe("ok");
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    expect(firm.matterVisibility).toBe("TEAM");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: { contains: "Matter visibility" } },
    });
    expect(log.userId).toBe(admin);
    expect(log.detail).toContain("Team only");
  });

  test("setting the current value writes nothing", async () => {
    await updateMatterVisibilityAction(idle, form("FIRM"));
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("a non-admin is bounced and nothing changes", async () => {
    mockedUser.mockResolvedValue(member);
    await expect(
      updateMatterVisibilityAction(idle, form("TEAM"))
    ).rejects.toThrow("NEXT_REDIRECT");
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    expect(firm.matterVisibility).toBe("FIRM");
  });

  test("rejects an unknown value", async () => {
    const r = await updateMatterVisibilityAction(idle, form("everyone"));
    expect(r.status).toBe("error");
  });
});

describe("thin teams", () => {
  test("classifyTeam", () => {
    expect(classifyTeam([])).toBe("no_members");
    expect(classifyTeam(["lead"])).toBe("lead_only");
    expect(classifyTeam(["lead", "paralegal"])).toBeNull();
    expect(classifyTeam(["paralegal"])).toBeNull();
  });

  test("lists empty and lead-only open matters, skips archived and full teams", async () => {
    const { matterId: leadOnly } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: admin,
      name: "Lead only",
    });
    const { matterId: full } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: admin,
      name: "Full team",
    });
    await prisma.matterTeamMember.create({
      data: { matterId: full, userId: member, role: "paralegal" },
    });
    const { matterId: empty } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: admin,
      name: "Empty",
    });
    await prisma.matterTeamMember.updateMany({
      where: { matterId: empty },
      data: { removedAt: new Date() },
    });
    const { matterId: archived } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: admin,
      name: "Archived thin",
    });
    await prisma.matter.update({
      where: { id: archived },
      data: { isArchived: true },
    });

    const thin = await listThinTeams();
    expect(thin.total).toBe(2);
    const byId = new Map(thin.rows.map((r) => [r.id, r]));
    expect(byId.get(leadOnly)?.reason).toBe("lead_only");
    expect(byId.get(empty)?.reason).toBe("no_members");
    expect(byId.has(full)).toBe(false);
    expect(byId.has(archived)).toBe(false);
  });
});
