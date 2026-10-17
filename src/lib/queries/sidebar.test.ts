/**
 * Integration tests for the sidebar aggregate.
 *
 * Pins the unread-email badge: it counts the viewer's OWN mailbox
 * only (never coworkers' unread volume) and excludes archived
 * threads. And the hours-today badge: "today" is the VIEWER's
 * calendar day, matched against the date-only (UTC midnight)
 * TimeEntry.date column.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn().mockResolvedValue("America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn().mockResolvedValue(false),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getSidebarData } from "@/lib/queries/sidebar";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let aId: string;
let bId: string;
let seq = 0;

async function seedThreads(
  ownerId: string,
  opts: { unread: number; archivedUnread?: number; read?: number }
) {
  const account = await prisma.emailAccount.create({
    data: { userId: ownerId, emailAddress: `box-${++seq}@firm.test` },
    select: { id: true },
  });
  const mk = (isRead: boolean, isArchived: boolean) =>
    prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "t",
        isRead,
        isArchived,
        lastMessageAt: new Date("2026-07-01T12:00:00Z"),
      },
    });
  for (let i = 0; i < opts.unread; i++) await mk(false, false);
  for (let i = 0; i < (opts.archivedUnread ?? 0); i++) await mk(false, true);
  for (let i = 0; i < (opts.read ?? 0); i++) await mk(true, false);
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: aId } = await seedUser({ firmId, name: "User A" }));
  ({ userId: bId } = await seedUser({ firmId, name: "User B" }));
});

describe("getSidebarData — unreadEmailCount", () => {
  test("counts only the viewer's own mailbox", async () => {
    await seedThreads(aId, { unread: 30 });
    await seedThreads(bId, { unread: 2 });

    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(2);

    mockedGetUser.mockResolvedValue(aId);
    expect((await getSidebarData()).unreadEmailCount).toBe(30);
  });

  test("is zero for a user with no connected mailbox, whatever others hold", async () => {
    await seedThreads(aId, { unread: 5 });
    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(0);
  });

  test("excludes archived and already-read threads", async () => {
    await seedThreads(bId, { unread: 3, archivedUnread: 4, read: 6 });
    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(3);
  });
});

describe("getSidebarData — areaCounts", () => {
  test("open matters in a retired practice area keep their name and colour", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Retired Area" });
    await prisma.practiceArea.update({
      where: { id: areaId },
      data: { isActive: false, color: "#123456" },
    });
    await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: aId });

    mockedGetUser.mockResolvedValue(aId);
    const { areaCounts } = await getSidebarData();
    expect(areaCounts).toHaveLength(1);
    expect(areaCounts[0]).toMatchObject({
      area: "Retired Area",
      count: 1,
      color: "#123456",
    });
  });
});

describe("getSidebarData — hoursToday", () => {
  let matterId: string;

  beforeEach(async () => {
    const area = await seedPracticeArea();
    ({ matterId } = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: bId,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const logHours = (userId: string, date: string, hours: number) =>
    prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(`${date}T00:00:00Z`),
        hours,
        activity: "Work",
      },
    });

  test("uses the viewer's day, not the server's, in the evening", async () => {
    // 8 PM Oct 15 in Denver = 02:00Z Oct 16 — the server clock is
    // already on the 16th, the viewer is still on the 15th.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:00:00Z"));
    await logHours(bId, "2026-10-15", 2);
    await logHours(bId, "2026-10-16", 5);
    mockedGetUser.mockResolvedValue(bId);

    expect((await getSidebarData()).hoursToday).toBe(2);
  });

  test("sums only the viewer's own entries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
    await logHours(bId, "2026-10-15", 1.5);
    await logHours(aId, "2026-10-15", 4);
    mockedGetUser.mockResolvedValue(bId);

    expect((await getSidebarData()).hoursToday).toBe(1.5);
  });
});
