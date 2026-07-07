/**
 * Integration tests for the /reports queries.
 *
 * Real Postgres (test container on :5433), same conventions as
 * dashboard.test.ts: only `Date` is faked so the pg driver's
 * timers keep working, and the clock freezes at an instant where
 * Denver and Tokyo disagree about the calendar day:
 *
 *   NOW = 2026-06-16T02:00:00Z
 *     → America/Denver: June 15, 8:00 PM (11 business days into June)
 *     → Asia/Tokyo:     June 16, 11:00 AM (12 business days)
 *
 * Focus per section:
 *   - pipeline: funnel counts exclude terminal lead stages; open-
 *     matter grouping excludes archived + terminal stages; the
 *     converted-this-quarter proxy respects the viewer-tz Q start
 *   - utilization: month lower bound on date-only entries, billable
 *     vs total split, inactive users dropped, goals read fresh off
 *     the Firm row, business-day capacity math
 *   - AR aging: status/kind filters, Decimal-safe outstanding,
 *     30/31-day bucket edge, worst-offender order + cap
 *   - realization: viewer-tz month keys, billed ⊂ worked, payment
 *     bucketing by landed date, zero-division guards
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

// getUtilizationReport resolves the viewer (for firm goals) via
// getCurrentUserId; stub the auth chain so next-auth doesn't load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getArAgingReport,
  getPipelineReport,
  getRealizationReport,
  getUtilizationReport,
} from "@/lib/queries/reports";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver";
const TOKYO = "Asia/Tokyo";
const DAY_MS = 24 * 60 * 60 * 1000;

let firmId: string;
let userId: string;
let areaId: string;
let stageId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea({ name: "§1983" }));
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

// ── Fixture helpers local to this file ──────────────────────────────────

let invoiceSeq = 0;
async function seedInvoice(opts: {
  matterId: string;
  issueDate: Date;
  total: number;
  paid?: number;
  status?: string;
  kind?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  invoiceSeq += 1;
  const invoiceNumber = `T-${String(invoiceSeq).padStart(3, "0")}`;
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber,
      matterId: opts.matterId,
      kind: opts.kind ?? "client",
      issueDate: opts.issueDate,
      dueDate: new Date(opts.issueDate.getTime() + 30 * DAY_MS),
      totalAmount: new Prisma.Decimal(opts.total),
      paidAmount: new Prisma.Decimal(opts.paid ?? 0),
      status: opts.status ?? "sent",
    },
    select: { id: true },
  });
  return { invoiceId: inv.id, invoiceNumber };
}

/** A time entry on a specific calendar day (server-local midnight —
 *  how parseLocalDate stores date-only columns). */
async function seedEntryOn(opts: {
  date: Date;
  hours: number;
  billable?: boolean;
  userId?: string;
  invoiceId?: string | null;
  amount?: number | null;
}): Promise<void> {
  await prisma.timeEntry.create({
    data: {
      matterId,
      userId: opts.userId ?? userId,
      date: opts.date,
      hours: opts.hours,
      activity: "Test work",
      billable: opts.billable ?? true,
      invoiceId: opts.invoiceId ?? null,
      amount:
        opts.amount != null ? new Prisma.Decimal(opts.amount) : null,
    },
  });
}

// ── Pipeline ────────────────────────────────────────────────────────────

describe("getPipelineReport", () => {
  test("funnel counts active stages only; converted/declined stay out of the queue", async () => {
    await prisma.lead.createMany({
      data: [
        { name: "L1", stage: "new" },
        { name: "L2", stage: "new" },
        { name: "L3", stage: "qualifying" },
        { name: "L4", stage: "hold" },
        { name: "L5", stage: "converted" },
        { name: "L6", stage: "declined" },
      ],
    });

    const report = await getPipelineReport(DENVER);

    expect(report.leadsByStage.map((s) => [s.stage, s.count])).toEqual([
      ["new", 2],
      ["contacted", 0],
      ["qualifying", 1],
      ["meeting", 0],
      ["hold", 1],
    ]);
    expect(report.totalActiveLeads).toBe(4);
  });

  test("convertedThisQuarter uses the viewer-tz quarter start (updatedAt proxy)", async () => {
    // Converted now (June 16 UTC) — inside Q2.
    await prisma.lead.create({
      data: { name: "Fresh convert", stage: "converted" },
    });
    // Converted, but last touched March 15 — Q1, excluded. Raw
    // UPDATE because prisma.update would bump @updatedAt back to now.
    const stale = await prisma.lead.create({
      data: { name: "Old convert", stage: "converted" },
      select: { id: true },
    });
    await prisma.$executeRaw`UPDATE leads SET "updatedAt" = ${new Date("2026-03-15T12:00:00Z")} WHERE id = ${stale.id}`;

    const report = await getPipelineReport(DENVER);
    expect(report.convertedThisQuarter).toBe(1);
  });

  test("open matters group area × stage, excluding archived + terminal stages", async () => {
    // Second stage on the seeded area + a terminal one.
    const discovery = await prisma.matterStage.create({
      data: { practiceAreaId: areaId, name: "Discovery", order: 1 },
      select: { id: true },
    });
    const closed = await prisma.matterStage.create({
      data: {
        practiceAreaId: areaId,
        name: "Closed",
        order: 2,
        isTerminal: true,
      },
      select: { id: true },
    });

    // beforeEach seeded one matter in Intake. Add: one in Discovery,
    // one archived (excluded), one in the terminal stage (excluded).
    await seedMatter({
      practiceAreaId: areaId,
      stageId: discovery.id,
      leadUserId: userId,
      name: "In discovery",
    });
    const archived = await seedMatter({
      practiceAreaId: areaId,
      stageId: discovery.id,
      leadUserId: userId,
      name: "Archived",
    });
    await prisma.matter.update({
      where: { id: archived.matterId },
      data: { isArchived: true },
    });
    await seedMatter({
      practiceAreaId: areaId,
      stageId: closed.id,
      leadUserId: userId,
      name: "Done",
    });

    const report = await getPipelineReport(DENVER);

    expect(report.totalOpenMatters).toBe(2);
    expect(report.areas).toHaveLength(1);
    const area = report.areas[0];
    expect(area.name).toBe("§1983");
    // Stage lifecycle order, zero-count stages omitted.
    expect(area.stages.map((s) => [s.name, s.count])).toEqual([
      ["Intake", 1],
      ["Discovery", 1],
    ]);
    expect(area.total).toBe(2);
  });
});

// ── Utilization ─────────────────────────────────────────────────────────

describe("getUtilizationReport", () => {
  test("splits billable vs total for the viewer-tz month; prior-month rows drop", async () => {
    await seedEntryOn({ date: new Date(2026, 5, 2), hours: 3 }); // June, billable
    await seedEntryOn({
      date: new Date(2026, 5, 10),
      hours: 1.5,
      billable: false,
    }); // June, non-billable
    await seedEntryOn({ date: new Date(2026, 4, 31), hours: 8 }); // May 31 — out

    const report = await getUtilizationReport(DENVER);

    const me = report.users.find((u) => u.userId === userId)!;
    expect(me.billableHours).toBe(3);
    expect(me.totalHours).toBe(4.5);
    expect(report.firmBillableMtd).toBe(3);
  });

  test("active zero-hour users appear; inactive users don't", async () => {
    const idle = await seedUser({ firmId, name: "Idle Associate" });
    const gone = await seedUser({
      firmId,
      name: "Departed",
      isActive: false,
    });
    // Even with hours logged, an inactive user stays off the report.
    await seedEntryOn({
      date: new Date(2026, 5, 3),
      hours: 2,
      userId: gone.userId,
    });

    const report = await getUtilizationReport(DENVER);

    const ids = report.users.map((u) => u.userId);
    expect(ids).toContain(idle.userId);
    expect(ids).not.toContain(gone.userId);
    const idleRow = report.users.find((u) => u.userId === idle.userId)!;
    expect(idleRow.totalHours).toBe(0);
  });

  test("goals read FRESH from the Firm row; capacity = dailyGoal × business days", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: { dailyHoursGoal: 5, monthlyBillableGoal: 150 },
    });

    const denver = await getUtilizationReport(DENVER);
    expect(denver.dailyHoursGoal).toBe(5);
    expect(denver.monthlyBillableGoal).toBe(150);
    // Denver's today is Mon June 15; June 1 2026 is a Monday, so
    // days 1–15 hold two weekends → 11 business days × 5h.
    expect(denver.monthCapacityHours).toBe(55);

    // Tokyo is already on Tue June 16 → one more business day.
    const tokyo = await getUtilizationReport(TOKYO);
    expect(tokyo.monthCapacityHours).toBe(60);
  });
});

// ── AR aging ────────────────────────────────────────────────────────────

describe("getArAgingReport", () => {
  const issuedDaysAgo = (days: number): Date =>
    new Date(NOW.getTime() - days * DAY_MS);

  test("buckets by age with Decimal-safe outstanding; filters status + kind", async () => {
    await seedInvoice({ matterId, issueDate: issuedDaysAgo(10), total: 500 });
    await seedInvoice({
      matterId,
      issueDate: issuedDaysAgo(45),
      total: 1000,
      paid: 400,
      status: "partial",
    });
    await seedInvoice({ matterId, issueDate: issuedDaysAgo(75), total: 250 });
    await seedInvoice({ matterId, issueDate: issuedDaysAgo(120), total: 800 });
    // Excluded rows: wrong status, wrong kind, fully paid.
    await seedInvoice({
      matterId,
      issueDate: issuedDaysAgo(200),
      total: 999,
      status: "draft",
    });
    await seedInvoice({
      matterId,
      issueDate: issuedDaysAgo(200),
      total: 999,
      status: "paid",
      paid: 999,
    });
    await seedInvoice({
      matterId,
      issueDate: issuedDaysAgo(200),
      total: 999,
      kind: "internal_record",
    });
    await seedInvoice({
      matterId,
      issueDate: issuedDaysAgo(15),
      total: 300,
      paid: 300, // sent but fully covered — not AR
    });

    const report = await getArAgingReport();

    expect(report.buckets.map((b) => [b.key, b.total, b.count])).toEqual([
      ["0-30", 500, 1],
      ["31-60", 600, 1], // 1000 − 400 partial payment
      ["61-90", 250, 1],
      ["90+", 800, 1],
    ]);
    expect(report.totalOutstanding).toBe(2150);
    expect(report.invoiceCount).toBe(4);
  });

  test("30 vs 31 day edge lands in adjacent buckets", async () => {
    await seedInvoice({ matterId, issueDate: issuedDaysAgo(30), total: 100 });
    await seedInvoice({ matterId, issueDate: issuedDaysAgo(31), total: 200 });

    const report = await getArAgingReport();
    expect(report.buckets[0]).toMatchObject({ key: "0-30", total: 100 });
    expect(report.buckets[1]).toMatchObject({ key: "31-60", total: 200 });
  });

  test("worst offenders: five oldest, oldest first, with matter link data", async () => {
    for (const days of [20, 40, 60, 80, 100, 120]) {
      await seedInvoice({
        matterId,
        issueDate: issuedDaysAgo(days),
        total: 100 + days,
      });
    }

    const report = await getArAgingReport();

    expect(report.worstOffenders).toHaveLength(5);
    expect(report.worstOffenders.map((o) => o.daysOutstanding)).toEqual([
      120, 100, 80, 60, 40,
    ]);
    expect(report.worstOffenders[0].matterId).toBe(matterId);
    expect(report.worstOffenders[0].matterName).toBe("Test Matter");
    expect(report.worstOffenders[0].outstanding).toBe(220);
  });

  test("empty book → four zero buckets, no offenders", async () => {
    const report = await getArAgingReport();
    expect(report.buckets.map((b) => b.total)).toEqual([0, 0, 0, 0]);
    expect(report.totalOutstanding).toBe(0);
    expect(report.worstOffenders).toEqual([]);
  });
});

// ── Realization ─────────────────────────────────────────────────────────

describe("getRealizationReport", () => {
  test("trailing 3 viewer-tz months: worked vs billed vs collected with percentages", async () => {
    const { invoiceId } = await seedInvoice({
      matterId,
      issueDate: new Date(2026, 3, 20),
      total: 1250,
    });

    // April: 10h worked billable, 5h of it billed at $1250.
    await seedEntryOn({ date: new Date(2026, 3, 10), hours: 5 });
    await seedEntryOn({
      date: new Date(2026, 3, 12),
      hours: 5,
      invoiceId,
      amount: 1250,
    });
    // Non-billable never counts as worked.
    await seedEntryOn({
      date: new Date(2026, 3, 15),
      hours: 9,
      billable: false,
    });
    // May: 8h worked, nothing billed.
    await seedEntryOn({ date: new Date(2026, 4, 5), hours: 8 });
    // April payment of $600 → collected 600 / billed 1250 = 48%.
    await prisma.invoicePayment.create({
      data: {
        invoiceId,
        source: "check",
        amount: new Prisma.Decimal(600),
        date: new Date(2026, 3, 25),
      },
    });

    const months = await getRealizationReport(DENVER);

    expect(months.map((m) => m.key)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(months[0].label).toMatch(/Apr 2026/);

    const april = months[0];
    expect(april.workedHours).toBe(10);
    expect(april.billedHours).toBe(5);
    expect(april.billedAmount).toBe(1250);
    expect(april.collectedAmount).toBe(600);
    expect(april.billedPctOfWorked).toBe(50);
    expect(april.collectedPctOfBilled).toBe(48);

    const may = months[1];
    expect(may.workedHours).toBe(8);
    expect(may.billedHours).toBe(0);
    // Zero-division guards: nothing billed → 0%, not NaN.
    expect(may.billedPctOfWorked).toBe(0);
    expect(may.collectedPctOfBilled).toBe(0);
  });

  test("month window follows the viewer's zone at a month boundary", async () => {
    // 2026-07-01T02:00Z → Denver still June 30, Tokyo already July 1.
    vi.setSystemTime(new Date("2026-07-01T02:00:00Z"));

    const denver = await getRealizationReport(DENVER);
    expect(denver.map((m) => m.key)).toEqual(["2026-04", "2026-05", "2026-06"]);

    const tokyo = await getRealizationReport(TOKYO);
    expect(tokyo.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});
