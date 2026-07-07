/**
 * Integration tests for countMatters.
 *
 * countMatters is the DB-side denominator behind the list page's
 * "showing N of M". Pins the contract the page relies on:
 *
 *   1. `filter.q` is ignored — text search is an in-memory concern of
 *      listMatters, so the count is "every filter except search".
 *   2. Non-search filters (practice area, archived default, terminal
 *      stages hidden unless showClosed) constrain the count exactly
 *      like they constrain the list.
 *   3. The count is NOT subject to LIST_MATTERS_CAP — with more
 *      matters than the cap, listMatters truncates but countMatters
 *      reports the true total.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// matters.ts imports getCurrentUserId (for pin lookups); stub it so the
// auth chain (next-auth → next/server) doesn't have to load. Tests pass
// an explicit userId, so the stub is never exercised.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { countMatters, listMatters } from "@/lib/queries/matters";
import { EMPTY_FILTER } from "@/lib/matters-filters";
import {
  resetDb,
  seedFirm,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let areaId: string;
let stageId: string;

/** Bulk-create bare matters (no team/deadlines — countMatters doesn't
 *  join them) in one round-trip. */
async function seedMatters(
  n: number,
  overrides: Partial<{
    practiceAreaId: string;
    stageId: string;
    isArchived: boolean;
    namePrefix: string;
  }> = {}
) {
  await prisma.matter.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      name: `${overrides.namePrefix ?? "Matter"} ${i}`,
      practiceAreaId: overrides.practiceAreaId ?? areaId,
      stageId: overrides.stageId ?? stageId,
      feeStructure: "hourly",
      isArchived: overrides.isArchived ?? false,
    })),
  });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
});

describe("countMatters", () => {
  test("ignores filter.q — search is in-memory in listMatters", async () => {
    await seedMatters(3);

    const count = await countMatters(
      { ...EMPTY_FILTER, q: "matches-nothing-zzz" },
      userId
    );
    expect(count).toBe(3);
  });

  test("honors non-search filters: area + archived default", async () => {
    const other = await seedPracticeArea({ name: "Other Area" });
    await seedMatters(2); // default area
    await seedMatters(3, {
      practiceAreaId: other.areaId,
      stageId: other.stageId,
      namePrefix: "Other",
    });
    await seedMatters(1, { isArchived: true, namePrefix: "Archived" });

    // Archived hidden by default → 2 + 3.
    expect(await countMatters(EMPTY_FILTER, userId)).toBe(5);
    // includeArchived opts the archived row back in.
    expect(
      await countMatters({ ...EMPTY_FILTER, includeArchived: true }, userId)
    ).toBe(6);
    // Area filter narrows by practice-area name.
    expect(
      await countMatters({ ...EMPTY_FILTER, areas: ["Other Area"] }, userId)
    ).toBe(3);
  });

  test("terminal-stage matters hidden unless showClosed", async () => {
    const closed = await prisma.matterStage.create({
      data: {
        practiceAreaId: areaId,
        name: "Closed",
        order: 99,
        isTerminal: true,
      },
      select: { id: true },
    });
    await seedMatters(2);
    await seedMatters(1, { stageId: closed.id, namePrefix: "Closed" });

    expect(await countMatters(EMPTY_FILTER, userId)).toBe(2);
    expect(
      await countMatters({ ...EMPTY_FILTER, showClosed: true }, userId)
    ).toBe(3);
  });

  test("not capped: reports the true total past LIST_MATTERS_CAP", async () => {
    await seedMatters(205);

    const [rows, count] = await Promise.all([
      listMatters(EMPTY_FILTER, { field: "created", dir: "desc" }, userId),
      countMatters(EMPTY_FILTER, userId),
    ]);
    expect(rows).toHaveLength(200); // list is capped…
    expect(count).toBe(205); // …the denominator is not
  });
});
