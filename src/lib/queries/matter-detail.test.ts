/**
 * Integration tests for the matter Time tab queries.
 *
 * Pins the list-cap / aggregate split introduced when the Time tab
 * stopped fetching unbounded rows:
 *
 *   1. getMatterTimeEntries is capped (newest-first) at
 *      MATTER_TIME_ENTRIES_LIMIT = 200 — a long-running hourly
 *      matter must not ship its entire history (plus attached note
 *      bodies) to render one tab.
 *
 *   2. getMatterTimeSummary aggregates in the database, so totals
 *      cover EVERY entry — including ones past the list cap — and
 *      per-bucket money sums happen in Decimal (no float dust from
 *      row-by-row JS accumulation).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// matter-detail.ts imports getCurrentUserId (for the Notes tab's
// read-tracking); stub it so the auth chain (next-auth → next/server)
// doesn't have to load. The time queries under test never call it.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getMatterTimeEntries,
  getMatterTimeSummary,
} from "@/lib/queries/matter-detail";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let userId: string;

/** A time entry with full control over the summary-relevant fields
 *  (the shared seedTimeEntry helper doesn't expose noCharge/date). */
async function seedEntry(opts: {
  hours?: number;
  amount?: number | string | null;
  billable?: boolean;
  noCharge?: boolean;
  status?: string;
  date?: Date;
}): Promise<string> {
  const row = await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      date: opts.date ?? new Date("2026-06-15"),
      hours: opts.hours ?? 1,
      activity: "Test work",
      amount: opts.amount == null ? null : new Prisma.Decimal(opts.amount),
      billable: opts.billable ?? true,
      noCharge: opts.noCharge ?? false,
      status: opts.status ?? "draft",
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
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

describe("getMatterTimeEntries — list cap", () => {
  test("caps at 200 newest entries while the summary still covers all rows", async () => {
    // 205 one-hour entries on distinct ascending dates so the
    // newest-first ordering is unambiguous.
    const base = Date.UTC(2026, 0, 1);
    await prisma.timeEntry.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        matterId,
        userId,
        date: new Date(base + i * 86_400_000),
        hours: 1,
        activity: `Test work #${i}`,
        billable: true,
        status: "draft",
      })),
    });

    const entries = await getMatterTimeEntries(matterId);
    expect(entries).toHaveLength(200);
    // Newest first — the 5 oldest (#0–#4) fall past the cap.
    expect(entries[0].activity).toBe("Test work #204");
    expect(entries[199].activity).toBe("Test work #5");

    // The aggregate side must NOT be capped with the list.
    const summary = await getMatterTimeSummary(matterId);
    expect(summary.totalHours).toBe(205);
    expect(summary.billableHours).toBe(205);
  });

  test("explicit limit option overrides the default cap", async () => {
    const base = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 4; i++) {
      await seedEntry({ date: new Date(base + i * 86_400_000) });
    }
    const entries = await getMatterTimeEntries(matterId, { limit: 3 });
    expect(entries).toHaveLength(3);
  });
});

describe("getMatterTimeSummary — bucketing", () => {
  test("splits billed vs unbilled and excludes no-charge / non-billable from billable totals", async () => {
    await seedEntry({ hours: 2, amount: 500, status: "billed" });
    await seedEntry({ hours: 1.5, amount: 375, status: "draft" });
    await seedEntry({ hours: 1, amount: 250, status: "billable" });
    // No-charge: counts toward total hours only.
    await seedEntry({ hours: 3, amount: 750, noCharge: true });
    // Non-billable, no amount: counts toward total hours only.
    await seedEntry({ hours: 0.5, amount: null, billable: false });

    const summary = await getMatterTimeSummary(matterId);
    expect(summary.totalHours).toBe(8);
    expect(summary.billableHours).toBe(4.5);
    expect(summary.billedAmount).toBe(500);
    expect(summary.unbilledAmount).toBe(625);
  });

  test("amount sums are exact at cent precision (Decimal math in the DB)", async () => {
    // 0.1 + 0.2 in doubles is 0.30000000000000004 — the classic
    // reproducer. Both entries land in the same groupBy bucket, so
    // Postgres sums them in Decimal and hands back exactly 0.3.
    await seedEntry({ amount: "0.10", status: "draft" });
    await seedEntry({ amount: "0.20", status: "draft" });

    const summary = await getMatterTimeSummary(matterId);
    expect(summary.unbilledAmount).toBe(0.3);
  });
});
