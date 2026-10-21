/**
 * Integration tests for the matters list / detail queries.
 *
 * countMatters is the DB-side denominator behind the list page's
 * "showing N of M". Pins the contract the page relies on:
 *
 *   1. `filter.q` is part of the shared where, so the count matches
 *      what a search can return.
 *   2. Non-search filters (practice area, archived default, terminal
 *      stages hidden unless showClosed) constrain the count exactly
 *      like they constrain the list.
 *   3. The count is NOT subject to paging — with more matters than a
 *      page, listMatters returns page 1 but countMatters reports the
 *      true total.
 *
 * listMatters: search and sort run over EVERY matching matter before
 * paging, and later pages continue the sorted result; deadline windows are calendar days in the viewer's zone
 * (due-today is not overdue; overdue is negative, not clamped to 0).
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

// matters.ts imports getCurrentUserId (for pin lookups); stub it so the
// auth chain (@clerk/nextjs → next/server) doesn't have to load. Tests pass
// an explicit userId, so the stub is never exercised.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { prisma } from "@/lib/prisma";
import {
  countMatters,
  getMatterById,
  getMattersFilterOptions,
  listMatters,
} from "@/lib/queries/matters";
import { EMPTY_FILTER } from "@/lib/matters-filters";
import { getCurrentUserId } from "@/lib/current-user";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
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
  test("honors filter.q — the denominator matches what search can return", async () => {
    await seedMatters(3);
    await prisma.matter.updateMany({
      where: { name: "Matter 1" },
      data: { caseNumber: "2026CV-777" },
    });

    expect(
      await countMatters({ ...EMPTY_FILTER, q: "matches-nothing-zzz" }, userId)
    ).toBe(0);
    expect(await countMatters({ ...EMPTY_FILTER, q: "matter 1" }, userId)).toBe(
      1
    );
    expect(
      await countMatters({ ...EMPTY_FILTER, q: "2026cv-777" }, userId)
    ).toBe(1);
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

  test("not paged: reports the true total past LIST_MATTERS_PAGE_SIZE", async () => {
    await seedMatters(205);

    const [{ rows }, count] = await Promise.all([
      listMatters(EMPTY_FILTER, { field: "created", dir: "desc" }, userId),
      countMatters(EMPTY_FILTER, userId),
    ]);
    expect(rows).toHaveLength(200); // page 1 holds one page…
    expect(count).toBe(205); // …the denominator is not
  });
});

// ── listMatters ─────────────────────────────────────────────────────────

const byCreated = { field: "created", dir: "desc" } as const;

describe("listMatters search + sort run before the row cap (F289/F305/F322/F344)", () => {
  test("a matter older than the newest 200 is still found by name and case number", async () => {
    // The old one is created FIRST, so 205 newer matters push it out of
    // the 200 newest.
    await prisma.matter.create({
      data: {
        name: "Alvarez v. City",
        caseNumber: "2019CV-001",
        practiceAreaId: areaId,
        stageId,
        feeStructure: "hourly",
        createdAt: new Date("2019-01-01T00:00:00Z"),
      },
    });
    await seedMatters(205);

    const { rows: byName } = await listMatters(
      { ...EMPTY_FILTER, q: "alvarez" },
      byCreated,
      userId,
      "UTC"
    );
    expect(byName.map((r) => r.name)).toEqual(["Alvarez v. City"]);

    const { rows: byCase } = await listMatters(
      { ...EMPTY_FILTER, q: "2019cv" },
      byCreated,
      userId,
      "UTC"
    );
    expect(byCase.map((r) => r.name)).toEqual(["Alvarez v. City"]);
    // …and the denominator agrees with the list.
    expect(await countMatters({ ...EMPTY_FILTER, q: "alvarez" }, userId)).toBe(1);
  });

  test("sort by name orders ALL matching matters, then caps", async () => {
    await prisma.matter.create({
      data: {
        name: "AAA first alphabetically",
        practiceAreaId: areaId,
        stageId,
        feeStructure: "hourly",
        createdAt: new Date("2019-01-01T00:00:00Z"),
      },
    });
    await seedMatters(205);

    const { rows } = await listMatters(
      EMPTY_FILTER,
      { field: "name", dir: "asc" },
      userId,
      "UTC"
    );
    expect(rows).toHaveLength(200);
    expect(rows[0]!.name).toBe("AAA first alphabetically");
  });

  test("page 2 continues the sorted result with no overlap", async () => {
    await prisma.matter.create({
      data: {
        name: "zzz last alphabetically",
        practiceAreaId: areaId,
        stageId,
        feeStructure: "hourly",
      },
    });
    await seedMatters(205);
    const byName = { field: "name", dir: "asc" } as const;

    const p1 = await listMatters(EMPTY_FILTER, byName, userId, "UTC", 1);
    const p2 = await listMatters(EMPTY_FILTER, byName, userId, "UTC", 2);
    expect(p1).toMatchObject({ total: 206, pageCount: 2, scanLimited: false });
    expect(p2.rows).toHaveLength(6);
    expect(p2.rows.at(-1)!.name).toBe("zzz last alphabetically");
    const seen = new Set(p1.rows.map((r) => r.id));
    expect(p2.rows.some((r) => seen.has(r.id))).toBe(false);
    // Past the end clamps to the last page.
    expect((await listMatters(EMPTY_FILTER, byName, userId, "UTC", 9)).page).toBe(2);
  });

  test("search treats LIKE wildcards literally", async () => {
    for (const name of ["50% off", "50x off", "a_b", "axb"]) {
      await prisma.matter.create({
        data: { name, practiceAreaId: areaId, stageId, feeStructure: "hourly" },
      });
    }
    const find = async (q: string) =>
      (await listMatters({ ...EMPTY_FILTER, q }, byCreated, userId, "UTC")).rows
        .map((r) => r.name)
        .sort();

    expect(await find("50%")).toEqual(["50% off"]);
    expect(await find("%")).toEqual(["50% off"]);
    expect(await find("a_b")).toEqual(["a_b"]);
    expect(await find("_")).toEqual(["a_b"]);
  });

  test("pinned matters sort first, ahead of the chosen field", async () => {
    await prisma.matter.create({
      data: { name: "A", practiceAreaId: areaId, stageId, feeStructure: "hourly" },
    });
    await prisma.matter.create({
      data: { name: "B", practiceAreaId: areaId, stageId, feeStructure: "hourly" },
    });
    const z = await prisma.matter.create({
      data: { name: "Z", practiceAreaId: areaId, stageId, feeStructure: "hourly" },
    });
    await prisma.userMatterPin.create({ data: { userId, matterId: z.id } });

    const { rows: asc } = await listMatters(
      EMPTY_FILTER,
      { field: "name", dir: "asc" },
      userId,
      "UTC"
    );
    expect(asc.map((r) => r.name)).toEqual(["Z", "A", "B"]);
    expect(asc[0]!.isPinned).toBe(true);
  });
});

describe("listMatters deadline math is calendar-day, in the viewer's zone (F304/F321)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A matter with one open deadline due on `dueKey` (UTC midnight). */
  async function matterDue(name: string, dueKey: string) {
    const m = await prisma.matter.create({
      data: { name, practiceAreaId: areaId, stageId, feeStructure: "hourly" },
    });
    await prisma.deadline.create({
      data: {
        matterId: m.id,
        title: "Due",
        dueDate: new Date(`${dueKey}T00:00:00Z`),
      },
    });
    return m.id;
  }

  const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name).sort();

  test("evening in Denver: due-today is not overdue; overdue keeps its sign", async () => {
    // 2026-04-28T02:00Z = Apr 27, 8 PM MDT.
    vi.useFakeTimers({ now: new Date("2026-04-28T02:00:00Z"), toFake: ["Date"] });
    await matterDue("due today", "2026-04-27");
    await matterDue("due tomorrow", "2026-04-28");
    await matterDue("late 12", "2026-04-15");
    await matterDue("in 8 days", "2026-05-05");
    await matterDue("in 20 days", "2026-05-17");

    const { rows: all } = await listMatters(
      EMPTY_FILTER,
      { field: "deadline", dir: "asc" },
      userId,
      "America/Denver"
    );
    const days = Object.fromEntries(all.map((r) => [r.name, r.nextDeadlineDays]));
    expect(days).toEqual({
      "late 12": -12,
      "due today": 0,
      "due tomorrow": 1,
      "in 8 days": 8,
      "in 20 days": 20,
    });
    // Ascending deadline sort puts the most overdue first.
    expect(all.map((r) => r.name)).toEqual([
      "late 12",
      "due today",
      "due tomorrow",
      "in 8 days",
      "in 20 days",
    ]);

    const { rows: overdue } = await listMatters(
      { ...EMPTY_FILTER, deadline: "overdue" },
      byCreated,
      userId,
      "America/Denver"
    );
    expect(names(overdue)).toEqual(["late 12"]);

    const { rows: w7 } = await listMatters(
      { ...EMPTY_FILTER, deadline: "within-7d" },
      byCreated,
      userId,
      "America/Denver"
    );
    // Open at the low end: the overdue matter stays in the window.
    expect(names(w7)).toEqual(["due today", "due tomorrow", "late 12"]);

    const { rows: w30 } = await listMatters(
      { ...EMPTY_FILTER, deadline: "within-30d" },
      byCreated,
      userId,
      "America/Denver"
    );
    expect(names(w30)).toEqual([
      "due today",
      "due tomorrow",
      "in 20 days",
      "in 8 days",
      "late 12",
    ]);
  });

  test("the day rolls over in the viewer's zone, not the server's", async () => {
    // 2026-04-28T02:00Z is still Apr 27 in Denver but already Apr 28 in UTC.
    vi.useFakeTimers({ now: new Date("2026-04-28T02:00:00Z"), toFake: ["Date"] });
    await matterDue("apr 27", "2026-04-27");

    const { rows: denver } = await listMatters(
      { ...EMPTY_FILTER, deadline: "overdue" },
      byCreated,
      userId,
      "America/Denver"
    );
    expect(denver).toHaveLength(0);

    const { rows: utc } = await listMatters(
      { ...EMPTY_FILTER, deadline: "overdue" },
      byCreated,
      userId,
      "UTC"
    );
    expect(utc.map((r) => r.name)).toEqual(["apr 27"]);
  });

  test("a completed deadline is not a next deadline; none filter still works", async () => {
    vi.useFakeTimers({ now: new Date("2026-04-28T18:00:00Z"), toFake: ["Date"] });
    const id = await matterDue("done", "2026-04-20");
    await prisma.deadline.updateMany({
      where: { matterId: id },
      data: { status: "completed" },
    });
    const { rows } = await listMatters(
      { ...EMPTY_FILTER, deadline: "none" },
      byCreated,
      userId,
      "UTC"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nextDeadlineDays).toBeNull();
  });
});

describe("listMatters billing-type filter", () => {
  const byCreated = { field: "created", dir: "desc" } as const;
  async function seed() {
    for (const [name, feeStructure, billingMode] of [
      ["court", "hourly", "court_voucher"],
      ["hourly", "hourly", "client"],
      ["contingent", "contingent", "client"],
    ] as const) {
      await prisma.matter.create({
        data: { name, practiceAreaId: areaId, stageId, feeStructure, billingMode },
      });
    }
  }
  const names = async (billingTypes: string[], q = "") =>
    (
      await listMatters({ ...EMPTY_FILTER, billingTypes, q }, byCreated, userId, "UTC")
    ).rows
      .map((r) => r.name)
      .sort();

  test("court_appointed returns only court_voucher matters", async () => {
    await seed();
    expect(await names(["court_appointed"])).toEqual(["court"]);
  });
  test("hourly excludes court_voucher matters", async () => {
    await seed();
    expect(await names(["hourly"])).toEqual(["hourly"]);
  });
  test("both together return both", async () => {
    await seed();
    expect(await names(["hourly", "court_appointed"])).toEqual(["court", "hourly"]);
  });
  test("composes with the text search OR", async () => {
    await seed();
    expect(await names(["hourly", "court_appointed"], "cour")).toEqual(["court"]);
  });
  test("rows expose the derived billing type", async () => {
    await seed();
    const { rows } = await listMatters(EMPTY_FILTER, byCreated, userId, "UTC");
    expect(rows.find((r) => r.name === "court")!.billingType).toBe("court_appointed");
  });
});

describe("getMattersFilterOptions (F762/F788/F849)", () => {
  test("billing types are the distinct derived values in use, sorted", async () => {
    const combos: Array<[string, string]> = [
      ["hourly", "client"],
      ["contingent", "client"],
      ["hourly", "client"],
      ["hourly", "court_voucher"],
    ];
    for (const [feeStructure, billingMode] of combos) {
      await prisma.matter.create({
        data: { name: "m", practiceAreaId: areaId, stageId, feeStructure, billingMode },
      });
    }
    const opts = await getMattersFilterOptions(userId);
    expect(opts.billingTypes).toEqual(["contingent", "court_appointed", "hourly"]);
  });

  test("leads: only active leads of active users", async () => {
    const { firmId } = await seedFirm({ name: "Other Firm" });
    const active = await seedUser({ firmId, name: "Active Lead", initials: "AL" });
    const gone = await seedUser({
      firmId,
      name: "Gone User",
      initials: "GU",
      isActive: false,
    });
    const former = await seedUser({ firmId, name: "Former Lead", initials: "FL" });
    const mk = (leadUserId: string) =>
      seedMatter({ practiceAreaId: areaId, stageId, leadUserId });
    await mk(active.userId);
    await mk(gone.userId);
    const { matterId } = await mk(former.userId);
    await prisma.matterTeamMember.updateMany({
      where: { matterId, userId: former.userId },
      data: { removedAt: new Date() },
    });

    const opts = await getMattersFilterOptions(userId);
    expect(opts.leads.map((l) => l.name)).toEqual(["Active Lead"]);
  });
});

describe("getMatterById (F307/F745/F763)", () => {
  test("team roster lists active members before former ones", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    const { firmId } = await seedFirm({ name: "Roster Firm" });
    const paralegal = await seedUser({ firmId, name: "Paula Paralegal" });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matterTeamMember.create({
      data: {
        matterId,
        userId: paralegal.userId,
        role: "paralegal",
        removedAt: new Date(),
      },
    });

    const matter = await getMatterById(matterId);
    expect(matter!.teamMembers.map((t) => [t.role, t.removedAt === null])).toEqual(
      [
        ["lead", true],
        ["paralegal", false],
      ]
    );
  });

  test("WIP is computed live from unbilled billable time, not the stale column", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    // Stale stored value that nothing maintains.
    await prisma.matter.update({
      where: { id: matterId },
      data: { wipAmount: 28400 },
    });
    await seedTimeEntry({ matterId, userId, hours: 2, rate: 250, amount: 500 });
    await seedTimeEntry({ matterId, userId, hours: 1, rate: 250, amount: 250 });
    // Excluded: non-billable, written off.
    await seedTimeEntry({ matterId, userId, amount: 999, billable: false });
    await seedTimeEntry({ matterId, userId, amount: 777, status: "written_off" });

    const matter = await getMatterById(matterId);
    expect(matter!.wipAmount).toBe(750);
  });

  test("a matter with no billable time shows WIP 0; unknown id → null", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    expect((await getMatterById(matterId))!.wipAmount).toBe(0);
    expect(await getMatterById("nope")).toBeNull();
  });
});
