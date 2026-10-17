/**
 * Tests for the intake (lead-scoped) time queries.
 *
 * summarizeLeadTime is the pure totals helper behind the intake Time
 * tab's summary cards; getLeadTimeEntries is the row query, which must
 * return only the lead's own entries, newest day first, with the
 * author id the row menu needs for its edit/delete visibility.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getLeadTimeEntries, summarizeLeadTime } from "./lead-time";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

describe("summarizeLeadTime", () => {
  test("empty list is 0 / 0", () => {
    expect(summarizeLeadTime([])).toEqual({ totalHours: 0, billableHours: 0 });
  });

  test("sheds float noise (0.1 + 0.2 -> 0.3)", () => {
    expect(
      summarizeLeadTime([
        { hours: 0.1, billable: true, noCharge: false },
        { hours: 0.2, billable: true, noCharge: false },
      ])
    ).toEqual({ totalHours: 0.3, billableHours: 0.3 });
  });

  test("no-charge counts toward total but not billable", () => {
    expect(
      summarizeLeadTime([
        { hours: 1, billable: true, noCharge: true },
        { hours: 0.5, billable: true, noCharge: false },
      ])
    ).toEqual({ totalHours: 1.5, billableHours: 0.5 });
  });

  test("non-billable counts toward total only", () => {
    expect(
      summarizeLeadTime([
        { hours: 2, billable: false, noCharge: false },
        { hours: 0.25, billable: true, noCharge: false },
      ])
    ).toEqual({ totalHours: 2.25, billableHours: 0.25 });
  });
});

describe("getLeadTimeEntries", () => {
  let userId: string;

  beforeAll(() => {
    expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  });

  beforeEach(async () => {
    await resetDb();
    const { firmId } = await seedFirm();
    userId = (await seedUser({ firmId, email: "intake@example.com" })).userId;
  });

  test("returns only this lead's entries, newest day first, with the author id", async () => {
    const { leadId } = await seedLead({ name: "Priya Patel" });
    const other = await seedLead({ name: "Someone Else" });
    const mk = (over: {
      leadId?: string;
      matterId?: string;
      date: string;
      activity: string;
    }) =>
      prisma.timeEntry.create({
        data: {
          userId,
          leadId: over.leadId ?? null,
          matterId: over.matterId ?? null,
          date: new Date(`${over.date}T00:00:00Z`),
          hours: 0.25,
          activity: over.activity,
        },
      });
    await mk({ leadId, date: "2026-06-10", activity: "older" });
    await mk({ leadId, date: "2026-06-12", activity: "newer" });
    await mk({ leadId: other.leadId, date: "2026-06-11", activity: "not mine" });

    const area = await seedPracticeArea();
    const matter = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    });
    await mk({ matterId: matter.matterId, date: "2026-06-11", activity: "matter" });

    const rows = await getLeadTimeEntries(leadId);

    expect(rows.map((r) => r.activity)).toEqual(["newer", "older"]);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.hours).toBe(0.25);
  });

  test("a lead with no time returns an empty list", async () => {
    const { leadId } = await seedLead();
    expect(await getLeadTimeEntries(leadId)).toEqual([]);
  });
});
