/**
 * Integration: restricting an intake and managing its team (ADR-049),
 * plus restricting a matter. Real Postgres; permission keys mocked
 * (requirePermission is asserted per call), the lead/matter walls real.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(async () => currentUser),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  addLeadTeamMember,
  removeLeadTeamMember,
  setLeadRestricted,
} from "@/app/actions/lead-access";
import { setMatterRestricted } from "@/app/actions/matters";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/;
let currentUser = "";
let firmId: string;
let alice: string;
let bob: string;
let leadId: string;

function as(userId: string) {
  currentUser = userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
}

function member(userId: string, role = "co_counsel"): FormData {
  const fd = new FormData();
  fd.set("userId", userId);
  fd.set("role", role);
  return fd;
}

const team = async () =>
  (
    await prisma.leadTeamMember.findMany({
      where: { leadId },
      select: { userId: true, role: true },
      orderBy: { createdAt: "asc" },
    })
  ).map((m) => `${m.userId}:${m.role}`);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  ({ firmId } = await seedFirm());
  ({ userId: alice } = await seedUser({ firmId, name: "Alice" }));
  ({ userId: bob } = await seedUser({ firmId, name: "Bob" }));
  ({ leadId } = await seedLead({ name: "Sensitive" }));
  as(alice);
});

describe("setLeadRestricted", () => {
  test("restricting adds the actor to the team, gates on intake.restrict and logs", async () => {
    expect(await setLeadRestricted(leadId, true)).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("intake.restrict");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).restricted).toBe(true);
    expect(await team()).toEqual([`${alice}:co_counsel`]);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { leadId } });
    expect(log.title).toMatch(/restricted/i);
    expect(log.matterId).toBeNull();
  });

  test("once restricted, a non-member can't reopen it (404)", async () => {
    await setLeadRestricted(leadId, true);
    as(bob);
    await expect(setLeadRestricted(leadId, false)).rejects.toThrow(NOT_FOUND);
  });

  test("reopening keeps the team rows and logs", async () => {
    await setLeadRestricted(leadId, true);
    expect(await setLeadRestricted(leadId, false)).toEqual({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).restricted).toBe(false);
    expect(await team()).toEqual([`${alice}:co_counsel`]);
    expect(await prisma.activityLog.count({ where: { leadId } })).toBe(2);
  });
});

describe("lead team", () => {
  beforeEach(async () => {
    await setLeadRestricted(leadId, true);
  });

  test("adding a member upserts their role and logs", async () => {
    expect(await addLeadTeamMember(leadId, member(bob, "paralegal"))).toEqual({ ok: true });
    expect(await addLeadTeamMember(leadId, member(bob, "investigator"))).toEqual({ ok: true });
    expect(await team()).toEqual([`${alice}:co_counsel`, `${bob}:investigator`]);
    as(bob);
    // Bob can now see it (and so manage it with the key).
    expect(await addLeadTeamMember(leadId, member(alice, "lead"))).toEqual({ ok: true });
  });

  test("an inactive user can't be added", async () => {
    const { userId: gone } = await seedUser({ firmId, isActive: false });
    const res = await addLeadTeamMember(leadId, member(gone));
    expect(res.ok).toBe(false);
    expect(await team()).toEqual([`${alice}:co_counsel`]);
  });

  test("the last member of a restricted lead can't be removed", async () => {
    const res = await removeLeadTeamMember(leadId, alice);
    expect(res).toEqual({
      ok: false,
      error: "A restricted intake needs at least one team member.",
    });
    expect(await team()).toEqual([`${alice}:co_counsel`]);
  });

  test("removing a member logs; the removed member loses access", async () => {
    await addLeadTeamMember(leadId, member(bob));
    expect(await removeLeadTeamMember(leadId, bob)).toEqual({ ok: true });
    expect(await team()).toEqual([`${alice}:co_counsel`]);
    as(bob);
    await expect(addLeadTeamMember(leadId, member(bob))).rejects.toThrow(NOT_FOUND);
  });

  test("an open lead's last member can be removed", async () => {
    await setLeadRestricted(leadId, false);
    expect(await removeLeadTeamMember(leadId, alice)).toEqual({ ok: true });
    expect(await team()).toEqual([]);
  });
});

describe("setMatterRestricted", () => {
  let matterId: string;
  beforeEach(async () => {
    const { areaId, stageId } = await seedPracticeArea();
    ({ matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: alice,
      name: "M",
    }));
  });

  test("restricts a matter with a team, gates on matters.restrict and logs", async () => {
    expect(await setMatterRestricted(matterId, true)).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("matters.restrict");
    expect((await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).restricted).toBe(
      true,
    );
    expect(await prisma.activityLog.count({ where: { matterId } })).toBe(1);
    as(bob);
    await expect(setMatterRestricted(matterId, false)).rejects.toThrow(NOT_FOUND);
  });

  test("refuses to restrict a matter with no active team member", async () => {
    await prisma.matterTeamMember.updateMany({
      where: { matterId },
      data: { removedAt: new Date() },
    });
    expect(await setMatterRestricted(matterId, true)).toEqual({
      ok: false,
      error: "Add a team member before restricting this matter.",
    });
  });
});
