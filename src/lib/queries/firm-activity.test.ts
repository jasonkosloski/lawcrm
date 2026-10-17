/**
 * Integration tests for the firm-wide activity log queries.
 *
 * `listFirmActivityAuthors` moved from `findMany({ distinct })`
 * (in-memory dedupe over the whole table) to a SQL `groupBy` +
 * user lookup — these pin the contract that survived the swap:
 * one entry per author no matter how many rows they wrote,
 * system (null-user) rows excluded, alphabetical order.
 *
 * `getFirmActivity`'s from/to filters cut on the VIEWER's calendar
 * days (ActivityLog.timestamp is an instant shown in the viewer's
 * zone), not the server's.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The queries scope by the session user's matter access.
let viewerId = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => viewerId),
}));
import { prisma } from "@/lib/prisma";
import {
  getFirmActivity,
  listFirmActivityAuthors,
} from "@/lib/queries/firm-activity";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let firmId: string;
let adminRoleId: string;

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
  ({ firmId, adminRoleId } = await seedFirm());
  ({ userId: viewerId } = await seedUser({ firmId, name: "Viewer", initials: "VV" }));
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

describe("getFirmActivity — from/to cut on the viewer's calendar days", () => {
  const DENVER = "America/Denver";

  async function logAt(title: string, timestamp: string): Promise<void> {
    await prisma.activityLog.create({
      data: { userId: null, type: "note", title, timestamp: new Date(timestamp) },
    });
  }

  async function titles(filter: Parameters<typeof getFirmActivity>[0]) {
    return (await getFirmActivity(filter)).map((r) => r.title).sort();
  }

  test("from = to = one Denver day returns exactly that local day", async () => {
    // Oct 15 in Denver (MDT, UTC-6) = 06:00Z Oct 15 .. 06:00Z Oct 16.
    await logAt("before", "2026-10-15T05:30:00Z"); // Oct 14, 11:30 PM
    await logAt("morning", "2026-10-15T14:00:00Z"); // Oct 15, 8 AM
    await logAt("evening", "2026-10-16T01:30:00Z"); // Oct 15, 7:30 PM
    await logAt("after", "2026-10-16T06:30:00Z"); // Oct 16, 12:30 AM

    expect(
      await titles({ from: "2026-10-15", to: "2026-10-15", tz: DENVER })
    ).toEqual(["evening", "morning"]);
  });

  test("a UTC viewer gets UTC days", async () => {
    await logAt("a", "2026-10-15T23:59:59.999Z");
    await logAt("b", "2026-10-16T00:00:00Z");
    expect(
      await titles({ from: "2026-10-15", to: "2026-10-15", tz: "UTC" })
    ).toEqual(["a"]);
  });

  test("open-ended bounds and malformed values", async () => {
    await logAt("old", "2026-10-01T12:00:00Z");
    await logAt("new", "2026-10-20T12:00:00Z");
    expect(await titles({ from: "2026-10-10", tz: DENVER })).toEqual(["new"]);
    expect(await titles({ to: "2026-10-10", tz: DENVER })).toEqual(["old"]);
    // Garbage and impossible dates are ignored rather than throwing.
    expect(
      await titles({ from: "not-a-date", to: "2026-02-31", tz: DENVER })
    ).toEqual(["new", "old"]);
  });

  test("the day bound survives the DST fall-back day", async () => {
    // Nov 1 2026: Denver falls back (MDT -> MST). Local Nov 1 runs
    // 06:00Z Nov 1 .. 07:00Z Nov 2 (25 hours).
    await logAt("late", "2026-11-02T06:30:00Z"); // Nov 1, 11:30 PM MST
    await logAt("next", "2026-11-02T07:30:00Z"); // Nov 2, 12:30 AM MST
    expect(
      await titles({ from: "2026-11-01", to: "2026-11-01", tz: DENVER })
    ).toEqual(["late"]);
  });
});

// F085 / F145: Settings → Activity is the audit trail, not a way
// around the settlement / expense / billing view keys.
describe("getFirmActivity — money rows follow their view keys", () => {
  async function seedMoneyRows() {
    await prisma.activityLog.createMany({
      data: [
        { type: "note", title: "Plain note" },
        { type: "settlement", title: "Settlement updated · gross $250,000.00" },
        { type: "deposit", title: "Trust deposit · $5,000.00" },
        { type: "filing", title: "Expense logged · $1,200.00 · Expert retainer" },
        { type: "filing", title: "Filed complaint" },
      ],
    });
  }
  const titles = async () => (await getFirmActivity()).map((r) => r.title).sort();

  test("a viewer without the keys sees no amounts", async () => {
    await seedMoneyRows();
    expect(await titles()).toEqual(["Filed complaint", "Plain note"]);
  });

  test("an admin (all keys) sees every row", async () => {
    ({ userId: viewerId } = await seedUser({ firmId, name: "Admin", roleIds: [adminRoleId] }));
    await seedMoneyRows();
    expect(await titles()).toHaveLength(5);
  });
});
