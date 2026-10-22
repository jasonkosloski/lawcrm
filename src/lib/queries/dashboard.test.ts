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
 * viewer TZ. Storage conventions under test (ADR-012):
 *   - timed CalendarEvent.startTime: real instant → bounds via instantInTz
 *   - Task/Deadline.dueDate, TimeEntry.date, all-day event bounds:
 *     date-only values stored at UTC midnight (parseDateOnly) and
 *     matched by the viewer's day key, never by an instant window.
 *
 * The cross-user cases seed a SECOND user whose private data must not
 * leak into the viewer's dashboard (mailbox, hours, event titles).
 *
 * Only `Date` is faked (not timers) so the Postgres driver's real
 * timers keep working.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// getMyOpenTasks resolves the owner via getCurrentUserId; stub the
// auth chain so @clerk/nextjs doesn't have to load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { parseDateOnly } from "@/lib/format-date";
import {
  getDashboardKpis,
  getFirmPulse,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
} from "@/lib/queries/dashboard";
import {
  resetDb,
  seedCalendarEvent,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

/** Make a user an Admin (every permission) so permission-gated
 *  dashboard data is visible to them. */
async function makeAdmin(uid: string): Promise<void> {
  await prisma.userRole.create({ data: { userId: uid, roleId: adminRoleId } });
}

/** Date-only value for a `YYYY-MM-DD` key (UTC midnight). */
const day = (key: string): Date => parseDateOnly(key)!;

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver"; // June 15 evening at NOW
const TOKYO = "Asia/Tokyo"; // June 16 morning at NOW

let firmId: string;
let matterId: string;
let userId: string;
let adminRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId, adminRoleId } = await seedFirm());
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
    // UTC midnight of June 15 - how a "2026-06-15" due date is stored.
    await prisma.task.create({
      data: {
        title: "File response",
        ownerId: userId,
        matterId,
        dueDate: day("2026-06-15"),
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
        dueDate: day("2026-06-23"),
      },
    });

    const tokyo = await getUpcomingDeadlines(TOKYO, 7);
    expect(tokyo.items.map((d) => d.title)).toEqual(["Discovery cutoff"]);
    expect(tokyo.items[0]!.days).toBe(7);

    const denver = await getUpcomingDeadlines(DENVER, 7);
    expect(denver.items).toHaveLength(0);
  });
});

describe("getDashboardKpis — hoursToday sums the user's local day", () => {
  test("entries dated June 15 vs June 16 split by viewer TZ", async () => {
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: day("2026-06-15"), // Denver's today
        hours: 2,
        activity: "Drafting",
      },
    });
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: day("2026-06-16"), // Tokyo's today
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

describe("goals come from the Firm row, not hardcoded constants", () => {
  test("fresh firm serves the schema defaults (6.0 / 200)", async () => {
    await makeAdmin(userId);
    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.hoursGoal).toBe(6.0);
    const pulse = await getFirmPulse(DENVER);
    expect(pulse!.billableGoal).toBe(200);
  });

  test("configured firm goals flow through to KPIs + pulse", async () => {
    await makeAdmin(userId);
    await prisma.firm.update({
      where: { id: firmId },
      data: { dailyHoursGoal: 8.5, monthlyBillableGoal: 175 },
    });

    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.hoursGoal).toBe(8.5);

    const pulse = await getFirmPulse(DENVER);
    expect(pulse!.billableGoal).toBe(175);
  });
});

describe("getRecentActivity — security audit rows stay off the dashboard", () => {
  test("auth events are excluded; work activity is shown", async () => {
    await prisma.activityLog.createMany({
      data: [
        { userId, type: "auth", title: "Signed in", timestamp: new Date(NOW.getTime() - 1000) },
        {
          userId,
          matterId,
          type: "note",
          title: "Added a note",
          timestamp: new Date(NOW.getTime() - 2000),
        },
      ],
    });
    const items = await getRecentActivity(DENVER);
    expect(items.map((i) => i.title)).toEqual(["Added a note"]);
  });

  test("firm-settings audit rows (e.g. reorder clicks) are excluded too", async () => {
    await prisma.activityLog.createMany({
      data: [
        {
          userId,
          type: "settings",
          title: "Moved stage up",
          timestamp: new Date(NOW.getTime() - 1000),
        },
        {
          userId,
          matterId,
          type: "note",
          title: "Added a note",
          timestamp: new Date(NOW.getTime() - 2000),
        },
      ],
    });
    const items = await getRecentActivity(DENVER);
    expect(items.map((i) => i.title)).toEqual(["Added a note"]);
  });
});

// ── Cross-user scoping (a second user's private data) ──────────────────

/** A second user with their own connected mailbox. */
async function seedOtherUserWithMailbox(): Promise<{
  otherId: string;
  otherAccountId: string;
}> {
  const { userId: otherId } = await seedUser({
    firmId,
    email: "other@example.com",
    name: "Other User",
  });
  const acct = await prisma.emailAccount.create({
    data: { userId: otherId, emailAddress: "other@gmail.example" },
    select: { id: true },
  });
  return { otherId, otherAccountId: acct.id };
}

async function seedViewerMailbox(): Promise<string> {
  const acct = await prisma.emailAccount.create({
    data: { userId, emailAddress: "viewer@gmail.example" },
    select: { id: true },
  });
  return acct.id;
}

describe("email KPIs + follow-ups are scoped to the viewer's mailbox", () => {
  test("unread / flagged count only the viewer's own non-archived threads", async () => {
    const mine = await seedViewerMailbox();
    const { otherAccountId } = await seedOtherUserWithMailbox();
    const t = (accountId: string, extra: object = {}) => ({
      accountId,
      subject: "s",
      lastMessageAt: NOW,
      ...extra,
    });
    await prisma.emailThread.createMany({
      data: [
        t(mine, { isRead: false }),
        t(mine, { isRead: false, isStarred: true }),
        t(mine, { isRead: false, isArchived: true }), // not "unread in my inbox"
        t(mine, { isRead: true, isStarred: true }), // read -> not flagged
        t(otherAccountId, { isRead: false }),
        t(otherAccountId, { isRead: false, isStarred: true }),
        t(otherAccountId, { isRead: false, isStarred: true }),
      ],
    });

    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.unreadEmail).toBe(2);
    expect(kpis.flaggedEmail).toBe(1);
  });

  test("another user's snoozed thread never reaches the viewer's follow-ups", async () => {
    const mine = await seedViewerMailbox();
    const { otherAccountId } = await seedOtherUserWithMailbox();
    await prisma.emailThread.createMany({
      data: [
        {
          accountId: otherAccountId,
          subject: "Re: Sexual harassment complaint - Jane Doe",
          lastMessageAt: NOW,
          followUpAt: new Date("2026-06-15T23:59:59.999Z"),
        },
        {
          accountId: mine,
          subject: "Mine to follow up",
          lastMessageAt: NOW,
          followUpAt: new Date("2026-06-15T23:59:59.999Z"),
        },
      ],
    });

    const items = await getFollowUpsDueToday(DENVER);
    expect(items.map((i) => i.label)).toEqual(["Mine to follow up"]);
  });
});

describe("getFollowUpsDueToday - a follow-up is overdue only after its day", () => {
  test("due today at 8 PM Denver is 'today', not overdue; yesterday's is overdue", async () => {
    const mine = await seedViewerMailbox();
    await prisma.emailThread.createMany({
      data: [
        {
          accountId: mine,
          subject: "Due today (Denver June 15)",
          lastMessageAt: NOW,
          // End of June 15, as the snooze action stores it on the
          // UTC production host.
          followUpAt: new Date("2026-06-15T23:59:59.999Z"),
        },
        {
          accountId: mine,
          subject: "Due yesterday",
          lastMessageAt: NOW,
          followUpAt: new Date("2026-06-14T23:59:59.999Z"),
        },
        {
          accountId: mine,
          subject: "Due tomorrow",
          lastMessageAt: NOW,
          followUpAt: new Date("2026-06-16T23:59:59.999Z"),
        },
      ],
    });

    // NOW is 02:00Z June 16 (8 PM June 15 in Denver). Comparing the raw
    // instant to "now" would call a same-day follow-up overdue from
    // 6 PM Denver; the day-key comparison does not.
    const items = await getFollowUpsDueToday(DENVER);
    expect(items.map((i) => [i.label, i.isOverdue])).toEqual([
      ["Due yesterday", true],
      ["Due today (Denver June 15)", false],
    ]);
  });
});

describe("getDashboardKpis - hoursToday is the viewer's own", () => {
  test("a colleague's hours on the same day are not added to mine", async () => {
    const { userId: otherId } = await seedUser({ firmId, email: "tk@example.com" });
    await prisma.timeEntry.createMany({
      data: [
        { matterId, userId, date: day("2026-06-15"), hours: 2, activity: "Mine" },
        { matterId, userId: otherId, date: day("2026-06-15"), hours: 7, activity: "Theirs" },
      ],
    });
    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.hoursToday).toBe(2);
  });
});

describe("getTodayAgenda - privacy and all-day events", () => {
  test("another user's private event is scrubbed to Busy", async () => {
    const { userId: otherId } = await seedUser({ firmId, email: "o2@example.com" });
    await seedCalendarEvent({
      createdById: otherId,
      title: "Therapy appointment",
      visibility: "private",
      startTime: new Date("2026-06-15T15:00:00Z"),
    });
    const agenda = await getTodayAgenda(DENVER);
    expect(agenda).toHaveLength(1);
    expect(agenda[0]!.title).toBe("Busy");
  });

  test("all-day events follow the date, not the instant window (Denver)", async () => {
    // Denver's today is June 15. UTC-midnight all-day events: June 15
    // is today's; June 16 must NOT show (it used to appear as "6:00p").
    await seedCalendarEvent({
      createdById: userId,
      title: "Trial day 1",
      isAllDay: true,
      startTime: day("2026-06-15"),
      endTime: day("2026-06-15"),
    });
    await seedCalendarEvent({
      createdById: userId,
      title: "Court closed",
      isAllDay: true,
      startTime: day("2026-06-16"),
      endTime: day("2026-06-16"),
    });
    const agenda = await getTodayAgenda(DENVER);
    expect(agenda.map((a) => [a.title, a.time])).toEqual([["Trial day 1", "All day"]]);
  });

  test("all-day events for the viewer's date (Tokyo), multi-day spans, listed first", async () => {
    await seedCalendarEvent({
      createdById: userId,
      title: "Timed call",
      startTime: new Date("2026-06-16T02:30:00Z"), // 11:30a Tokyo
    });
    await seedCalendarEvent({
      createdById: userId,
      title: "Conference",
      isAllDay: true,
      startTime: day("2026-06-14"),
      endTime: day("2026-06-17"), // inclusive end: covers the 16th
    });
    await seedCalendarEvent({
      createdById: userId,
      title: "Yesterday only",
      isAllDay: true,
      startTime: day("2026-06-15"),
      endTime: day("2026-06-15"),
    });
    const agenda = await getTodayAgenda(TOKYO);
    expect(agenda.map((a) => [a.title, a.time])).toEqual([
      ["Conference", "All day"],
      ["Timed call", "11:30a"],
    ]);
  });
});

describe("getUpcomingDeadlines - overdue rows are signed and scoped", () => {
  test("overdue shows a negative day count with its matter; archived matters drop out", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Other area" });
    const archived = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: archived.matterId },
      data: { isArchived: true },
    });
    await prisma.deadline.createMany({
      data: [
        { matterId, title: "Answer (12d late)", dueDate: day("2026-06-03") },
        { matterId, title: "Due today", dueDate: day("2026-06-15") },
        { matterId, title: "Already done", dueDate: day("2026-06-10"), status: "completed" },
        { matterId: archived.matterId, title: "On archived", dueDate: day("2026-06-16") },
      ],
    });

    const { items } = await getUpcomingDeadlines(DENVER, 7);
    expect(items.map((d) => [d.title, d.days])).toEqual([
      ["Answer (12d late)", -12],
      ["Due today", 0],
    ]);
    expect(items[0]!.matterId).toBe(matterId);
    expect(items[0]!.matterName).toBeTruthy();
  });

  test("a stale overdue backlog cannot hide a deadline due this week", async () => {
    await prisma.deadline.createMany({
      data: [
        ...Array.from({ length: 30 }, (_, i) => ({
          matterId,
          title: `Stale ${i}`,
          dueDate: day("2026-05-01"),
        })),
        { matterId, title: "Due in 3 days", dueDate: day("2026-06-18") },
      ],
    });
    const { items, overdueHidden } = await getUpcomingDeadlines(DENVER, 7);
    expect(items.map((d) => d.title)).toContain("Due in 3 days");
    // Overdue rows are capped at 10 and lead the list; the rest are counted.
    expect(items.filter((d) => d.days < 0)).toHaveLength(10);
    expect(overdueHidden).toBe(20);
    expect(items[items.length - 1]!.title).toBe("Due in 3 days");
  });

  test("the upcoming window is capped at 20 rows", async () => {
    await prisma.deadline.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        matterId,
        title: `Soon ${i}`,
        dueDate: day("2026-06-17"),
      })),
    });
    const { items, overdueHidden } = await getUpcomingDeadlines(DENVER, 7);
    expect(items).toHaveLength(20);
    expect(overdueHidden).toBe(0);
  });
});

describe("getMyOpenTasks - ordering, closed statuses and caps", () => {
  test("within a day, urgent > high > normal > low (not alphabetical)", async () => {
    const mk = (title: string, priority: string) => ({
      title,
      priority,
      ownerId: userId,
      matterId,
      dueDate: day("2026-06-15"),
    });
    await prisma.task.createMany({
      data: [
        mk("low one", "low"),
        mk("high one", "high"),
        mk("normal one", "normal"),
        mk("urgent one", "urgent"),
      ],
    });
    const res = await getMyOpenTasks(DENVER);
    expect(res.today.map((t) => t.title)).toEqual([
      "urgent one",
      "high one",
      "normal one",
      "low one",
    ]);
  });

  test("done / cancelled tasks and other owners' tasks are excluded", async () => {
    const { userId: otherId } = await seedUser({ firmId, email: "o3@example.com" });
    await prisma.task.createMany({
      data: [
        { title: "open", ownerId: userId, matterId },
        { title: "done", ownerId: userId, matterId, status: "done" },
        { title: "cancelled", ownerId: userId, matterId, status: "cancelled" },
        { title: "theirs", ownerId: otherId, matterId },
      ],
    });
    const res = await getMyOpenTasks(DENVER);
    expect(res.total).toBe(1);
    expect(res.noDueDate.map((t) => t.title)).toEqual(["open"]);
  });

  test("buckets are capped; total stays accurate and the remainder is reported", async () => {
    await prisma.task.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        title: `late ${i}`,
        ownerId: userId,
        matterId,
        dueDate: day("2026-06-01"),
      })),
    });
    const res = await getMyOpenTasks(DENVER);
    expect(res.total).toBe(30);
    expect(res.overdue).toHaveLength(25);
    expect(res.hidden).toBe(5);
    // The badge count is exact, not the capped list length.
    expect(res.overdueCount).toBe(30);
  });
});

describe("getFirmPulse - only collectible invoices count", () => {
  test("void, draft and internal-record invoices are not A/R or collection", async () => {
    await makeAdmin(userId);
    const base = {
      matterId,
      issueDate: day("2026-06-01"),
      dueDate: day("2026-07-01"),
    };
    await prisma.invoice.createMany({
      data: [
        { ...base, invoiceNumber: "T-1", status: "sent", totalAmount: 1000, paidAmount: 250 },
        { ...base, invoiceNumber: "T-2", status: "void", totalAmount: 9000, paidAmount: 0 },
        { ...base, invoiceNumber: "T-3", status: "draft", totalAmount: 5000, paidAmount: 0 },
        {
          ...base,
          invoiceNumber: "T-4",
          kind: "internal_record",
          status: "sent",
          totalAmount: 700,
          paidAmount: 700,
        },
      ],
    });
    const pulse = await getFirmPulse(DENVER);
    expect(pulse!.arOutstanding).toBe(750);
    expect(pulse!.collectionRate).toBe(25);
  });
});
