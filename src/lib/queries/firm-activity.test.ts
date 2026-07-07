/**
 * Integration tests for the firm-wide activity log queries.
 *
 * `listFirmActivityAuthors` moved from `findMany({ distinct })`
 * (in-memory dedupe over the whole table) to a SQL `groupBy` +
 * user lookup — these pin the contract that survived the swap:
 * one entry per author no matter how many rows they wrote,
 * system (null-user) rows excluded, alphabetical order.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { listFirmActivityAuthors } from "@/lib/queries/firm-activity";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let firmId: string;

async function seedLogRow(userId: string | null): Promise<void> {
  await prisma.activityLog.create({
    data: {
      userId,
      type: "note",
      title: "Test entry",
    },
  });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
});

describe("listFirmActivityAuthors", () => {
  test("dedupes authors with many rows and sorts by name", async () => {
    const { userId: zoeId } = await seedUser({
      firmId,
      name: "Zoe Ward",
      initials: "ZW",
    });
    const { userId: alexId } = await seedUser({
      firmId,
      name: "Alex Byrne",
      initials: "AB",
    });
    // Zoe authored three rows — she must still appear exactly once.
    await seedLogRow(zoeId);
    await seedLogRow(zoeId);
    await seedLogRow(zoeId);
    await seedLogRow(alexId);

    const authors = await listFirmActivityAuthors();
    expect(authors).toEqual([
      { id: alexId, name: "Alex Byrne", initials: "AB" },
      { id: zoeId, name: "Zoe Ward", initials: "ZW" },
    ]);
  });

  test("excludes system rows (null userId) and users with no log rows", async () => {
    const { userId } = await seedUser({
      firmId,
      name: "Maria Alvarez",
      initials: "MA",
    });
    // A second user exists but never wrote a log row — not an author.
    await seedUser({ firmId, name: "Quiet Colleague", initials: "QC" });
    await seedLogRow(userId);
    await seedLogRow(null); // system event

    const authors = await listFirmActivityAuthors();
    expect(authors).toEqual([
      { id: userId, name: "Maria Alvarez", initials: "MA" },
    ]);
  });

  test("returns empty when the log has only system rows", async () => {
    await seedLogRow(null);
    expect(await listFirmActivityAuthors()).toEqual([]);
  });
});
