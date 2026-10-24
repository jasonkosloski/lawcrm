/**
 * Integration tests (real DB) for the smaller dashboard cards: pinned
 * matters, upcoming SOLs, time this week, new leads and unbilled time.
 * Covers the matter and lead walls, the billing.view gate, and the
 * viewer's-day boundaries.
 *
 * Clock frozen at 2026-06-16T02:00Z = Monday June 15, 8pm in Denver, so
 * the viewer's "today" is June 15 in Denver and June 16 in UTC.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getNewLeads,
  getPinnedMatters,
  getTimeThisWeek,
  getUnbilledTime,
  getUpcomingSols,
  weekKeysContaining,
} from "@/lib/queries/dashboard-cards";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver";

let firmId: string;
let areaId: string;
let stageId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Visible Matter",
  }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const day = (key: string) => new Date(`${key}T00:00:00Z`);

async function grant(uid: string, ...permissions: string[]): Promise<void> {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId: role.id, permission })),
  });
  await prisma.userRole.create({ data: { userId: uid, roleId: role.id } });
}

/** TEAM mode: matters are visible to their team only. */
async function wallFirm(): Promise<void> {
  await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
}

async function otherMatter(name: string, leadUserId = userId): Promise<string> {
  const { matterId: id } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId, name });
  return id;
}

describe("getPinnedMatters", () => {
  test("only my pins on visible, unarchived matters, with the next open deadline", async () => {
    const other = (await seedUser({ firmId, name: "Other" })).userId;
    const archived = await otherMatter("Archived");
    await prisma.matter.update({ where: { id: archived }, data: { isArchived: true } });
    const walled = await otherMatter("Walled", other);
    const notPinned = await otherMatter("Not pinned");
    await wallFirm();
    await prisma.userMatterPin.createMany({
      data: [
        { userId, matterId },
        { userId, matterId: archived },
        { userId, matterId: walled },
        { userId: other, matterId: notPinned },
      ],
    });
    await prisma.deadline.createMany({
      data: [
        { matterId, title: "Later", dueDate: day("2026-06-30"), status: "open" },
        { matterId, title: "Soonest", dueDate: day("2026-06-17"), status: "open" },
        { matterId, title: "Done", dueDate: day("2026-06-10"), status: "completed" },
      ],
    });

    const items = await getPinnedMatters(DENVER);
    expect(items.map((m) => m.name)).toEqual(["Visible Matter"]);
    expect(items[0].stageName).toBe("Intake");
    expect(items[0].nextDeadline?.title).toBe("Soonest");
    expect(items[0].nextDeadline?.days).toBe(2);
  });
});

describe("getUpcomingSols", () => {
  async function sol(name: string, key: string, data: Prisma.MatterUpdateInput = {}) {
    const id = await otherMatter(name);
    await prisma.matter.update({
      where: { id },
      data: { statuteOfLimitationsDate: day(key), ...data },
    });
    return id;
  }

  test("lapsed first, then the 90-day window; satisfied, closed and archived are out", async () => {
    // Viewer's today is June 15 (Denver); day 90 is Sept 13.
    await sol("Lapsed", "2026-06-01");
    await sol("Day 90", "2026-09-13");
    await sol("Day 91", "2026-09-14");
    await sol("Soon", "2026-06-20");
    await sol("Satisfied", "2026-06-20", { statuteOfLimitationsSatisfied: true });
    await sol("Archived", "2026-06-20", { isArchived: true });
    const closed = await prisma.matterStage.create({
      data: { practiceAreaId: areaId, name: "Closed", order: 1, isTerminal: true },
    });
    await sol("Closed", "2026-06-20", { stage: { connect: { id: closed.id } } });

    const { items, hidden, lapsed } = await getUpcomingSols(DENVER);
    expect(items.map((s) => s.matterName)).toEqual(["Lapsed", "Soon", "Day 90"]);
    expect(items.map((s) => s.days)).toEqual([-14, 5, 90]);
    expect(hidden).toBe(0);
    expect(lapsed).toBe(1);
  });

  test("the lapsed count covers SOLs past the row cap; today is not lapsed", async () => {
    for (let i = 1; i <= 12; i++) {
      await sol(`Lapsed ${i}`, `2026-05-${String(i).padStart(2, "0")}`);
    }
    await sol("Due today", "2026-06-15");
    const { items, hidden, lapsed } = await getUpcomingSols(DENVER);
    expect(items).toHaveLength(10);
    expect(hidden).toBe(3);
    expect(lapsed).toBe(12);
  });

  test("a walled-off matter's SOL never appears", async () => {
    await wallFirm();
    await sol("Mine", "2026-06-20");
    const other = (await seedUser({ firmId, name: "Other" })).userId;
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect((await getUpcomingSols(DENVER)).items).toEqual([]);
  });
});

describe("time this week", () => {
  test("weekKeysContaining is Sunday-first", () => {
    expect(weekKeysContaining("2026-06-15")).toEqual([
      "2026-06-14",
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
    ]);
    // A Sunday starts its own week.
    expect(weekKeysContaining("2026-06-14")[0]).toBe("2026-06-14");
  });

  test("sums my hours per day in the viewer's week against the firm goal", async () => {
    const other = (await seedUser({ firmId, name: "Other" })).userId;
    const entry = (uid: string, key: string, hours: number, billable = true) =>
      prisma.timeEntry.create({
        data: { matterId, userId: uid, date: day(key), hours, activity: "Work", billable },
      });
    await entry(userId, "2026-06-15", 2);
    await entry(userId, "2026-06-15", 0.5, false);
    await entry(userId, "2026-06-20", 1);
    await entry(userId, "2026-06-13", 4); // last week
    await entry(other, "2026-06-15", 3); // someone else's

    const week = await getTimeThisWeek(DENVER);
    expect(week.todayKey).toBe("2026-06-15");
    expect(week.days.map((d) => d.totalHours)).toEqual([0, 2.5, 0, 0, 0, 0, 1]);
    expect(week.totalHours).toBe(3.5);
    expect(week.billableHours).toBe(3);
    expect(week.dailyGoal).toBe(6);
  });
});

describe("getNewLeads", () => {
  test("the viewer's last 7 calendar days, open leads only, restricted hidden from non-team", async () => {
    const lead = async (name: string, createdAt: Date, restricted = false, stage = "new") => {
      const { leadId } = await seedLead({ name, restricted });
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt, stage } });
    };
    // Denver today is June 15, so the window opens June 9 00:00 MDT (06:00Z).
    await lead("Two days", new Date("2026-06-14T02:00:00Z"));
    await lead("Today", new Date("2026-06-16T01:00:00Z"));
    await lead("June 9, 1am", new Date("2026-06-09T07:00:00Z"));
    await lead("June 8, 11pm", new Date("2026-06-09T05:00:00Z"));
    await lead("Restricted", new Date("2026-06-15T01:00:00Z"), true);
    await lead("Converted", new Date("2026-06-15T01:00:00Z"), false, "converted");
    await lead("Declined", new Date("2026-06-15T01:00:00Z"), false, "declined");

    const { items, hidden } = await getNewLeads(DENVER);
    expect(items.map((l) => l.name)).toEqual(["Today", "Two days", "June 9, 1am"]);
    expect(hidden).toBe(0);
  });
});

describe("getUnbilledTime", () => {
  test("null without billing.view", async () => {
    await seedTimeEntry({ matterId, userId, hours: 2 });
    expect(await getUnbilledTime()).toBeNull();
  });

  test("WIP time on visible matters, top matters by amount, with totals", async () => {
    await grant(userId, "billing.view");
    const big = await otherMatter("Big");
    const other = (await seedUser({ firmId, name: "Other" })).userId;
    const walled = await otherMatter("Walled", other);
    await wallFirm();

    await seedTimeEntry({ matterId, userId, hours: 1, rate: 200 });
    await seedTimeEntry({ matterId: big, userId, hours: 4, rate: 300 });
    await seedTimeEntry({ matterId: big, userId, hours: 1, rate: 300, status: "draft" });
    // Not WIP: billed, written off, non-billable, no-charge, intake.
    await seedTimeEntry({ matterId, userId, hours: 9, status: "billed" });
    await seedTimeEntry({ matterId, userId, hours: 9, status: "written_off" });
    await seedTimeEntry({ matterId, userId, hours: 9, billable: false });
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, hours: 9 });
    await prisma.timeEntry.update({ where: { id: timeEntryId }, data: { noCharge: true } });
    const { leadId } = await seedLead();
    await seedTimeEntry({ leadId, userId, hours: 9 });
    // Walled-off matter.
    await seedTimeEntry({ matterId: walled, userId: other, hours: 9 });

    const data = await getUnbilledTime();
    expect(data?.items).toEqual([
      { matterId: big, matterName: "Big", hours: 5, amount: 1500 },
      { matterId, matterName: "Visible Matter", hours: 1, amount: 200 },
    ]);
    expect(data?.totalHours).toBe(6);
    expect(data?.totalAmount).toBe(1700);
    expect(data?.hidden).toBe(0);
  });

  test("unpriced time never outranks priced time; caps at the limit with an exact +N", async () => {
    await grant(userId, "billing.view");
    // Five matters of priced time, plus one with only unpriced (no rate) time.
    for (let i = 1; i <= 5; i++) {
      await seedTimeEntry({ matterId: await otherMatter(`Priced ${i}`), userId, hours: i });
    }
    const unpriced = await otherMatter("Unpriced");
    await prisma.timeEntry.create({
      data: { matterId: unpriced, userId, date: day("2026-06-15"), hours: 40, activity: "Work" },
    });
    // The top matter's unpriced hours still count toward its row.
    const top = (await prisma.matter.findFirstOrThrow({ where: { name: "Priced 5" } })).id;
    await prisma.timeEntry.create({
      data: { matterId: top, userId, date: day("2026-06-15"), hours: 2, activity: "Work" },
    });

    const data = await getUnbilledTime();
    expect(data?.items.map((m) => m.matterName)).toEqual([
      "Priced 5",
      "Priced 4",
      "Priced 3",
      "Priced 2",
      "Priced 1",
    ]);
    expect(data?.items[0]).toMatchObject({ hours: 7, amount: 1250 });
    expect(data?.hidden).toBe(1);
    expect(data?.totalHours).toBe(57);
  });
});
