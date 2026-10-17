/**
 * Multi-user integration tests for dashboard privacy + correctness
 * (W3b): per-mailbox email, calendar Busy scrub on the agenda,
 * reports.view / firm.view_activity / settlement / expense gating,
 * and A/R filters mirroring /reports.
 *
 * Clock frozen at 2026-06-16T02:00Z (June 15, 8pm in Denver).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getDashboardKpis,
  getFirmPulse,
  getFollowUpsDueToday,
  getRecentActivity,
  getTodayAgenda,
} from "@/lib/queries/dashboard";
import {
  resetDb,
  seedCalendarEvent,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver";

let firmId: string;
let adminRoleId: string;
let matterId: string;
let userId: string;
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId, adminRoleId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
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

async function makeAdmin(uid: string): Promise<void> {
  await prisma.userRole.create({ data: { userId: uid, roleId: adminRoleId } });
}

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

async function seedOtherUser(): Promise<string> {
  const { userId: id } = await seedUser({ firmId, name: "Other User" });
  return id;
}

async function seedThread(opts: {
  ownerId: string;
  subject: string;
  followUpAt?: Date | null;
  starred?: boolean;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts.ownerId,
      emailAddress: `${Math.random().toString(36).slice(2, 8)}@firm.test`,
    },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      subject: opts.subject,
      isRead: false,
      lastMessageAt: NOW,
      followUpAt: opts.followUpAt ?? null,
      // "Flagged" on the dashboard = starred + unread (no code path ever
      // wrote the old "urgent" EmailLabel, F601).
      isStarred: opts.starred ?? false,
    },
    select: { id: true },
  });
  return thread.id;
}

describe("email counts + follow-ups are scoped to the viewer's own mailbox", () => {
  test("unread / flagged counts ignore other users' threads", async () => {
    const other = await seedOtherUser();
    await seedThread({ ownerId: userId, subject: "mine", starred: true });
    await seedThread({ ownerId: other, subject: "theirs 1", starred: true });
    await seedThread({ ownerId: other, subject: "theirs 2" });

    const mine = await getDashboardKpis(DENVER);
    expect(mine.unreadEmail).toBe(1);
    expect(mine.flaggedEmail).toBe(1);

    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    const theirs = await getDashboardKpis(DENVER);
    expect(theirs.unreadEmail).toBe(2);
    expect(theirs.flaggedEmail).toBe(1);
  });

  test("follow-ups never list another user's thread, and take:50 is not eaten by them", async () => {
    const other = await seedOtherUser();
    const due = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    await seedThread({
      ownerId: other,
      subject: "Re: settlement authority - do not share",
      followUpAt: due,
    });
    const mineId = await seedThread({
      ownerId: userId,
      subject: "my follow up",
      followUpAt: new Date(due.getTime() + 1000),
    });

    const items = await getFollowUpsDueToday(DENVER);
    expect(items.map((i) => i.id)).toEqual([mineId]);
    expect(items.map((i) => i.label)).toEqual(["my follow up"]);
  });
});

describe("getTodayAgenda - calendar visibility resolver", () => {
  const start = new Date("2026-06-16T03:00:00Z"); // 9pm Denver, June 15 = today

  test("another user's personal + non-team matter events show as Busy", async () => {
    const other = await seedOtherUser();
    const { matterId: otherMatter } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: other,
      name: "Doe v. City",
    });
    await seedCalendarEvent({
      createdById: other,
      title: "Therapy - Dr. Smith",
      startTime: start,
    });
    await seedCalendarEvent({
      createdById: other,
      matterId: otherMatter,
      title: "Settlement conference - Doe",
      startTime: new Date(start.getTime() + 60 * 60 * 1000),
    });

    const agenda = await getTodayAgenda(DENVER);
    expect(agenda).toHaveLength(2);
    expect(agenda.map((a) => a.title)).toEqual(["Busy", "Busy"]);
    expect(agenda.every((a) => a.area === "Firm")).toBe(true);
    expect(JSON.stringify(agenda)).not.toMatch(/Therapy|Settlement|Doe/);
  });

  test("creator, attendee, show_details and creator-default see details", async () => {
    const other = await seedOtherUser();
    await seedCalendarEvent({ createdById: userId, title: "Mine", startTime: start });
    await seedCalendarEvent({
      createdById: other,
      title: "Invited",
      startTime: new Date(start.getTime() + 60_000),
      attendees: [{ userId, name: "Me" }],
    });
    await seedCalendarEvent({
      createdById: other,
      title: "Happy hour",
      visibility: "show_details",
      startTime: new Date(start.getTime() + 120_000),
    });
    await seedCalendarEvent({
      createdById: other,
      title: "Hidden",
      startTime: new Date(start.getTime() + 180_000),
    });

    expect((await getTodayAgenda(DENVER)).map((a) => a.title)).toEqual([
      "Mine",
      "Invited",
      "Happy hour",
      "Busy",
    ]);

    await prisma.user.update({
      where: { id: other },
      data: { defaultEventVisibility: "show_details" },
    });
    expect((await getTodayAgenda(DENVER)).map((a) => a.title)).toEqual([
      "Mine",
      "Invited",
      "Happy hour",
      "Hidden",
    ]);
  });

  test("active matter-team member sees matter events", async () => {
    const other = await seedOtherUser();
    await seedCalendarEvent({
      createdById: other,
      matterId,
      title: "Team hearing",
      startTime: start,
    });
    expect((await getTodayAgenda(DENVER)).map((a) => a.title)).toEqual([
      "Team hearing",
    ]);
  });
});

describe("firm-wide financials require reports.view", () => {
  async function seedInvoice(opts: {
    n: string;
    status: string;
    kind?: string;
    total: number;
    paid: number;
  }): Promise<void> {
    await prisma.invoice.create({
      data: {
        invoiceNumber: `T-${opts.n}`,
        matterId,
        kind: opts.kind ?? "client",
        status: opts.status,
        issueDate: NOW,
        dueDate: NOW,
        totalAmount: opts.total,
        paidAmount: opts.paid,
      },
    });
  }

  test("viewer without reports.view gets no pulse and no trust figures", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { trustBalance: 5000 },
    });
    expect(await getFirmPulse(DENVER)).toBeNull();
    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.trustBalance).toBeNull();
    expect(kpis.trustMatterCount).toBeNull();
  });

  test("reports.view holder gets pulse + trust total", async () => {
    await grant(userId, "reports.view");
    await prisma.matter.update({
      where: { id: matterId },
      data: { trustBalance: 5000 },
    });
    expect(await getFirmPulse(DENVER)).not.toBeNull();
    const kpis = await getDashboardKpis(DENVER);
    expect(kpis.trustBalance).toBe(5000);
    expect(kpis.trustMatterCount).toBe(1);
  });

  test("A/R and collection rate exclude void, draft, approved and internal records", async () => {
    await makeAdmin(userId);
    // Counted: sent 1000 (paid 0), partial 2000 (paid 500), paid 1000
    await seedInvoice({ n: "1", status: "sent", total: 1000, paid: 0 });
    await seedInvoice({ n: "2", status: "partial", total: 2000, paid: 500 });
    await seedInvoice({ n: "3", status: "paid", total: 1000, paid: 1000 });
    // Excluded noise:
    await seedInvoice({ n: "4", status: "void", total: 5000, paid: 0 });
    await seedInvoice({ n: "5", status: "draft", total: 20000, paid: 0 });
    await seedInvoice({ n: "6", status: "approved", total: 7000, paid: 0 });
    await seedInvoice({
      n: "7",
      status: "paid",
      kind: "internal_record",
      total: 20000,
      paid: 20000,
    });
    await seedInvoice({
      n: "8",
      status: "sent",
      kind: "internal_record",
      total: 3000,
      paid: 0,
    });

    const pulse = (await getFirmPulse(DENVER))!;
    expect(pulse.arOutstanding).toBe(2500); // (1000-0) + (2000-500)
    expect(pulse.collectionRate).toBeCloseTo(37.5, 5); // 1500 collected / 4000 billed
  });
});

describe("getRecentActivity - permission-gated rows", () => {
  beforeEach(async () => {
    const t = (n: number) => new Date(NOW.getTime() - n * 1000);
    await prisma.activityLog.createMany({
      data: [
        { userId, matterId, type: "note", title: "Added a note", timestamp: t(1) },
        {
          userId,
          matterId,
          type: "settlement",
          title: "Settlement opened · gross $850000.00",
          timestamp: t(2),
        },
        {
          userId,
          matterId,
          type: "filing",
          title: "Expense logged · $120.00 · Expert retainer",
          timestamp: t(3),
        },
        {
          userId,
          matterId: null,
          type: "filing",
          title: 'Revoked "Void invoices" from Jane Doe',
          timestamp: t(4),
        },
      ],
    });
  });

  test("no keys: only ordinary matter work is shown", async () => {
    const items = await getRecentActivity(DENVER, 10);
    expect(items.map((i) => i.title)).toEqual(["Added a note"]);
  });

  test("settlement.view unlocks only settlement rows", async () => {
    await grant(userId, "matters.settlement.view");
    expect((await getRecentActivity(DENVER, 10)).map((i) => i.title)).toEqual([
      "Added a note",
      "Settlement opened · gross $850000.00",
    ]);
  });

  test("expense.view + firm.view_activity unlock expense and firm-scope rows", async () => {
    await grant(userId, "matters.expense.view", "firm.view_activity");
    expect((await getRecentActivity(DENVER, 10)).map((i) => i.title)).toEqual([
      "Added a note",
      "Expense logged · $120.00 · Expert retainer",
      'Revoked "Void invoices" from Jane Doe',
    ]);
  });

  test("admin sees everything", async () => {
    await makeAdmin(userId);
    expect(await getRecentActivity(DENVER, 10)).toHaveLength(4);
  });
});
