/**
 * Integration tests for the /time page queries.
 *
 * Conventions under test (matching the committed date-only column
 * story — see src/lib/queries/dashboard.ts header):
 *   - TimeEntry.date is stored at server-local midnight of its
 *     calendar day; the queries take/emit YYYY-MM-DD day keys and
 *     round-trip them through server-local date parts.
 *   - Everything is scoped to the CURRENT user — other users'
 *     entries on the same days must never leak in.
 *   - hours is Float: sums are rounded to 2 decimals so float
 *     accumulation noise (0.1+0.2) never reaches the view.
 *   - amount is Decimal: converted to number at the boundary.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getMyDayTime, getMyRunningTimer, getMyWeekTime } from "@/lib/queries/time";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

// The week of Sunday 2026-06-14 → Saturday 2026-06-20.
const WEEK_KEYS = [
  "2026-06-14",
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
  "2026-06-20",
];

let userId: string;
let otherUserId: string;
let matterAId: string; // red
let matterBId: string; // default blue

/** Entry factory — server-local midnight date, controllable source
 *  / flags. (seedTimeEntry pins date to `new Date()`, which these
 *  tests must control.) Scope with matterId OR leadId (intake
 *  time) — exactly one, per the TimeEntry invariant. */
async function createEntry(opts: {
  userId: string;
  matterId?: string;
  leadId?: string;
  date: Date;
  hours: number;
  billable?: boolean;
  noCharge?: boolean;
  source?: string;
  activity?: string;
  narrative?: string | null;
  status?: string;
  amount?: number | null;
}): Promise<string> {
  const row = await prisma.timeEntry.create({
    data: {
      userId: opts.userId,
      matterId: opts.matterId ?? null,
      leadId: opts.leadId ?? null,
      date: opts.date,
      hours: opts.hours,
      billable: opts.billable ?? true,
      noCharge: opts.noCharge ?? false,
      source: opts.source ?? "manual",
      activity: opts.activity ?? "Test work",
      narrative: opts.narrative ?? null,
      status: opts.status ?? "draft",
      amount: opts.amount != null ? new Prisma.Decimal(opts.amount) : null,
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  ({ userId: otherUserId } = await seedUser({ firmId, name: "Other User" }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId: matterAId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Matter A",
  }));
  ({ matterId: matterBId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Matter B",
  }));
  await prisma.matter.update({
    where: { id: matterAId },
    data: { color: "#cc0000" },
  });
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
});

describe("getMyWeekTime", () => {
  test("groups per day per matter, splits billable, sorts segments desc", async () => {
    const monday = new Date(2026, 5, 15);
    // Matter A on Monday: 1.5h billable + 0.5h non-billable = 2.0h.
    await createEntry({ userId, matterId: matterAId, date: monday, hours: 1.5 });
    await createEntry({
      userId,
      matterId: matterAId,
      date: monday,
      hours: 0.5,
      billable: false,
    });
    // Matter B on Monday: 2.5h billable — the wider segment.
    await createEntry({ userId, matterId: matterBId, date: monday, hours: 2.5 });

    const week = await getMyWeekTime(WEEK_KEYS);
    const mon = week.days[1]!;
    expect(mon.dayKey).toBe("2026-06-15");
    expect(mon.totalHours).toBe(4.5);
    expect(mon.billableHours).toBe(4);
    expect(mon.segments.map((s) => s.matterName)).toEqual([
      "Matter B",
      "Matter A",
    ]);
    expect(mon.segments[1]).toMatchObject({
      matterId: matterAId,
      matterColor: "#cc0000",
      hours: 2,
      billableHours: 1.5,
    });
  });

  test("no-charge hours count as worked but not billable", async () => {
    await createEntry({
      userId,
      matterId: matterAId,
      date: new Date(2026, 5, 16),
      hours: 1,
      billable: true,
      noCharge: true,
    });

    const week = await getMyWeekTime(WEEK_KEYS);
    expect(week.days[2]!.totalHours).toBe(1);
    expect(week.days[2]!.billableHours).toBe(0);
  });

  test("returns a stable row per requested key, empty days included", async () => {
    const week = await getMyWeekTime(WEEK_KEYS);
    expect(week.days.map((d) => d.dayKey)).toEqual(WEEK_KEYS);
    expect(week.days.every((d) => d.segments.length === 0)).toBe(true);
    expect(week.totalHours).toBe(0);
    expect(week.billableHours).toBe(0);
  });

  test("excludes other users and out-of-week days; totals roll up", async () => {
    await createEntry({
      userId,
      matterId: matterAId,
      date: new Date(2026, 5, 15),
      hours: 2,
    });
    // Other user, same day — must not leak in.
    await createEntry({
      userId: otherUserId,
      matterId: matterAId,
      date: new Date(2026, 5, 15),
      hours: 8,
    });
    // Current user, the Saturday BEFORE the week — outside bounds.
    await createEntry({
      userId,
      matterId: matterAId,
      date: new Date(2026, 5, 13),
      hours: 8,
    });

    const week = await getMyWeekTime(WEEK_KEYS);
    expect(week.totalHours).toBe(2);
    expect(week.billableHours).toBe(2);
  });

  test("float-noise sums are rounded (0.1 × 3 = 0.3, not 0.30000000004)", async () => {
    const date = new Date(2026, 5, 17);
    for (let i = 0; i < 3; i++) {
      await createEntry({ userId, matterId: matterAId, date, hours: 0.1 });
    }
    const week = await getMyWeekTime(WEEK_KEYS);
    expect(week.days[3]!.totalHours).toBe(0.3);
    expect(week.totalHours).toBe(0.3);
  });
});

describe("getMyDayTime — reconciliation lanes", () => {
  test("splits lanes by source; totals span both lanes", async () => {
    const date = new Date(2026, 5, 15);
    await createEntry({
      userId,
      matterId: matterAId,
      date,
      hours: 1.5,
      activity: "Draft motion",
      narrative: "Motion to compel discovery responses",
      status: "billable",
      amount: 375,
    });
    await createEntry({
      userId,
      matterId: matterBId,
      date,
      hours: 0.4,
      source: "email",
      activity: "Email · opposing counsel",
    });
    await createEntry({
      userId,
      matterId: matterBId,
      date,
      hours: 0.6,
      source: "timer",
      activity: "Timer session",
      billable: false,
    });

    const day = await getMyDayTime("2026-06-15");
    expect(day.logged.map((e) => e.activity)).toEqual(["Draft motion"]);
    expect(day.captured.map((e) => e.source)).toEqual(["email", "timer"]);
    expect(day.totalHours).toBe(2.5);
    expect(day.billableHours).toBe(1.9);

    // Decimal → number at the boundary; narrative/status thread through.
    expect(day.logged[0]).toMatchObject({
      amount: 375,
      status: "billable",
      narrative: "Motion to compel discovery responses",
      matterColor: "#cc0000",
    });
  });

  test("scopes to the current user and the requested day only", async () => {
    await createEntry({
      userId: otherUserId,
      matterId: matterAId,
      date: new Date(2026, 5, 15),
      hours: 3,
    });
    await createEntry({
      userId,
      matterId: matterAId,
      date: new Date(2026, 5, 16),
      hours: 3,
    });

    const day = await getMyDayTime("2026-06-15");
    expect(day.logged).toHaveLength(0);
    expect(day.captured).toHaveLength(0);
    expect(day.totalHours).toBe(0);
  });
});

describe("getMyRunningTimer", () => {
  test("null when the user has no running session", async () => {
    expect(await getMyRunningTimer()).toBeNull();
  });

  test("returns the session with its matter; other users' timers invisible", async () => {
    const startedAt = new Date("2026-06-15T16:00:00Z");
    await prisma.timerSession.create({
      data: { userId, matterId: matterAId, activity: "Deposition prep", startedAt },
    });
    await prisma.timerSession.create({
      data: { userId: otherUserId, activity: "Someone else's work" },
    });

    const timer = await getMyRunningTimer();
    expect(timer).toMatchObject({
      activity: "Deposition prep",
      matterId: matterAId,
      matterName: "Matter A",
      matterColor: "#cc0000",
    });
    expect(timer!.startedAt.getTime()).toBe(startedAt.getTime());
  });

  test("matterless timer comes back with null matter fields", async () => {
    await prisma.timerSession.create({ data: { userId } });
    const timer = await getMyRunningTimer();
    expect(timer).toMatchObject({
      matterId: null,
      matterName: null,
      matterColor: null,
    });
  });
});

// ── Lead-scoped (intake) entries in the /time views ─────────────────────

describe("lead-scoped entries — intake context instead of a matter", () => {
  const monday = new Date(2026, 5, 15);

  test("getMyWeekTime: intake segment carries the lead's name + leadId, neutral color", async () => {
    const { leadId } = await seedLead({ name: "Priya Patel" });
    await createEntry({ userId, leadId, date: monday, hours: 0.75, billable: false });
    await createEntry({ userId, matterId: matterAId, date: monday, hours: 1 });

    const week = await getMyWeekTime(WEEK_KEYS);
    const mon = week.days[1]!;
    expect(mon.totalHours).toBe(1.75);

    const intakeSeg = mon.segments.find((s) => s.leadId === leadId);
    expect(intakeSeg).toMatchObject({
      matterId: leadId, // segment key = lead id for intake time
      matterName: "Intake · Priya Patel",
      matterColor: "var(--color-ink-3)",
      hours: 0.75,
      billableHours: 0,
    });
    // The matter segment is untouched by the lead entry.
    const matterSeg = mon.segments.find((s) => s.matterId === matterAId);
    expect(matterSeg?.leadId).toBeUndefined();
    expect(matterSeg?.hours).toBe(1);
  });

  test("getMyDayTime: intake row has null matterId, leadId set, lead-name context", async () => {
    const { leadId } = await seedLead({ name: "Priya Patel" });
    await createEntry({
      userId,
      leadId,
      date: monday,
      hours: 0.5,
      activity: "Conflict check",
      billable: false,
    });

    const day = await getMyDayTime("2026-06-15");
    expect(day.logged).toHaveLength(1);
    expect(day.logged[0]).toMatchObject({
      matterId: null,
      leadId,
      matterName: "Intake · Priya Patel",
      matterColor: "var(--color-ink-3)",
      activity: "Conflict check",
      hours: 0.5,
    });
    expect(day.totalHours).toBe(0.5);
    expect(day.billableHours).toBe(0);
  });
});
