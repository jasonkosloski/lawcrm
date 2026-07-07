/**
 * Integration tests for the dashboard queries' time-zone handling.
 *
 * "Today" on the dashboard must be the USER's calendar day, not the
 * server's. Every scenario below freezes the clock at an instant
 * where two viewers disagree about what day it is:
 *
 *   NOW = 2026-06-16T02:00:00Z
 *     → America/Denver (UTC-6): June 15, 8:00 PM
 *     → Asia/Tokyo    (UTC+9): June 16, 11:00 AM
 *
 * The same DB rows must land in different buckets / windows per
 * viewer TZ. Storage conventions under test:
 *   - CalendarEvent.startTime: real instant → bounds via instantInTz
 *   - Task/Deadline.dueDate, TimeEntry.date: date-only stored at
 *     server-local midnight → bounds via the date-key round-trip
 *     (dateKeyInTz → server-local midnight), matching parseLocalDate.
 *
 * Only `Date` is faked (not timers) so the Postgres driver's real
 * timers keep working.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// getMyOpenTasks resolves the owner via getCurrentUserId; stub the
// auth chain so next-auth doesn't have to load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getDashboardKpis,
  getMyOpenTasks,
  getTodayAgenda,
  getUpcomingDeadlines,
} from "@/lib/queries/dashboard";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver"; // June 15 evening at NOW
const TOKYO = "Asia/Tokyo"; // June 16 morning at NOW

let matterId: string;
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTodayAgenda — user-local day bounds on real instants", () => {
  beforeEach(async () => {
    // 2026-06-15T12:00Z = June 15 6:00 AM Denver (today there),
    //                     June 15 9:00 PM Tokyo (yesterday there).
    await prisma.calendarEvent.create({
      data: {
        matterId,
        title: "Morning hearing",
        startTime: new Date("2026-06-15T12:00:00Z"),
        endTime: new Date("2026-06-15T13:00:00Z"),
      },
    });
    // 2026-06-16T02:30Z = June 15 8:30 PM Denver / June 16 11:30 AM
    // Tokyo — "today" for both viewers.
    await prisma.calendarEvent.create({
      data: {
        matterId,
        title: "Late call",
        startTime: new Date("2026-06-16T02:30:00Z"),
        endTime: new Date("2026-06-16T03:00:00Z"),
      },
    });
  });

  test("west-of-UTC viewer sees both of their local day's events", async () => {
    const agenda = await getTodayAgenda(DENVER);
    expect(agenda.map((a) => a.title)).toEqual(["Morning hearing", "Late call"]);
  });

  test("east-of-UTC viewer's yesterday events drop off", async () => {
    const agenda = await getTodayAgenda(TOKYO);
    expect(agenda.map((a) => a.title)).toEqual(["Late call"]);
  });

  test("times render in the viewer's zone, not the server's", async () => {
    const denver = await getTodayAgenda(DENVER);
    expect(denver.find((a) => a.title === "Late call")!.time).toBe("8:30p");
    const tokyo = await getTodayAgenda(TOKYO);
    expect(tokyo.find((a) => a.title === "Late call")!.time).toBe("11:30a");
  });
});

describe("getMyOpenTasks — due-date buckets follow the user's today", () => {
  test("same row is 'today' in Denver but overdue in Tokyo", async () => {
    // Server-local midnight of June 15 — how parseLocalDate stores
    // a "2026-06-15" due date regardless of server zone.
    await prisma.task.create({
      data: {
        title: "File response",
        ownerId: userId,
        matterId,
        dueDate: new Date(2026, 5, 15),
      },
    });

    const denver = await getMyOpenTasks(DENVER);
    expect(denver.today.map((t) => t.title)).toEqual(["File response"]);
    expect(denver.today[0]!.daysUntilDue).toBe(0);
    expect(denver.overdue).toHaveLength(0);

    const tokyo = await getMyOpenTasks(TOKYO);
    expect(tokyo.overdue.map((t) => t.title)).toEqual(["File response"]);
    expect(tokyo.overdue[0]!.daysUntilDue).toBe(-1);
    expect(tokyo.today).toHaveLength(0);
  });
});

describe("getUpcomingDeadlines — window end anchored to the user's today", () => {
  test("day 7 for Tokyo is day 8 (excluded) for Denver", async () => {
    // June 23 = Tokyo's today (June 16) + 7 → inside its window;
    // Denver's today (June 15) + 7 = June 22 → June 23 is out.
    await prisma.deadline.create({
      data: {
        matterId,
        title: "Discovery cutoff",
        dueDate: new Date(2026, 5, 23),
      },
    });

    const tokyo = await getUpcomingDeadlines(TOKYO, 7);
    expect(tokyo.map((d) => d.title)).toEqual(["Discovery cutoff"]);
    expect(tokyo[0]!.days).toBe(7);

    const denver = await getUpcomingDeadlines(DENVER, 7);
    expect(denver).toHaveLength(0);
  });
});

describe("getDashboardKpis — hoursToday sums the user's local day", () => {
  test("entries dated June 15 vs June 16 split by viewer TZ", async () => {
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(2026, 5, 15), // Denver's today
        hours: 2,
        activity: "Drafting",
      },
    });
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(2026, 5, 16), // Tokyo's today
        hours: 3,
        activity: "Research",
      },
    });

    const denver = await getDashboardKpis(DENVER);
    expect(denver.hoursToday).toBe(2);

    const tokyo = await getDashboardKpis(TOKYO);
    expect(tokyo.hoursToday).toBe(3);
  });
});
