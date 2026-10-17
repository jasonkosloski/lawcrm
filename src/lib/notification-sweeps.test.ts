/**
 * Integration tests for the deadline notification sweep.
 *
 * Deadline due dates are DATE-ONLY values (ADR-012: UTC midnight of
 * the calendar day), so every fixture here is built with
 * `parseDateOnly` and every "now" is chosen to show where the
 * recipient's calendar day differs from the server's UTC day.
 *
 * The load-bearing properties:
 *   - calendar-day buckets: due today is "today", never overdue; a
 *     deadline is overdue only once its day has fully passed in the
 *     RECIPIENT's zone (the old instant comparison flagged it at the
 *     start of the due day UTC = 6 PM the evening before in Denver);
 *   - idempotency: the sweep is invoked from every dashboard load AND
 *     a platform cron, so re-running never duplicates a notice. Each
 *     (userId, type, link) triple — threshold in `due`, due date in
 *     `on` — is a one-time event;
 *   - a rescheduled deadline (extension, SOL correction) starts a
 *     fresh cycle of notices;
 *   - recipients: active owner, else the active team (a deactivated
 *     owner doesn't swallow the notice);
 *   - overlapping runs don't double-write.
 *
 * Also covered: window edges (> 7 days = silence), skips for
 * non-open statuses + archived matters, and the in-memory hourly
 * throttle on the dashboard entry point.
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { addDaysToKey, parseDateOnly } from "@/lib/format-date";
import {
  DEADLINE_IMMINENT_THRESHOLD_DAYS,
  DEADLINE_SOON_THRESHOLD_DAYS,
  SWEEP_MIN_INTERVAL_MS,
  bucketForDaysUntil,
  maybeRunDeadlineNotificationSweep,
  resetSweepThrottleForTests,
  runDeadlineNotificationSweep,
} from "@/lib/notification-sweeps";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
// Noon UTC on Jul 7 = 6 AM Jul 7 in Denver (default user zone): the
// recipient and the server agree on the day.
const NOW = new Date("2026-07-07T12:00:00Z");
const TODAY = "2026-07-07";
/** A date-only due date `days` calendar days from TODAY. */
const dueIn = (days: number): Date => parseDateOnly(addDaysToKey(TODAY, days))!;

let firmId: string;
let ownerId: string;
let teammateId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  resetSweepThrottleForTests();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId, email: "owner@example.com" });
  ownerId = u.userId;
  const u2 = await seedUser({ firmId, email: "teammate@example.com" });
  teammateId = u2.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: ownerId,
  });
  matterId = m.matterId;
  // Second active team member for the ownerless fan-out cases.
  await prisma.matterTeamMember.create({
    data: { matterId, userId: teammateId, role: "paralegal" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const seedDeadline = async (over?: {
  dueDate?: Date;
  ownerId?: string | null;
  status?: string;
  title?: string;
  matterId?: string;
}): Promise<string> => {
  const d = await prisma.deadline.create({
    data: {
      matterId: over?.matterId ?? matterId,
      title: over?.title ?? "Discovery cutoff",
      dueDate: over?.dueDate ?? dueIn(5),
      ownerId: over?.ownerId === undefined ? ownerId : over.ownerId,
      status: over?.status ?? "open",
    },
    select: { id: true },
  });
  return d.id;
};

const sweepAt = (isoOrDate: string | Date) =>
  runDeadlineNotificationSweep(
    typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate
  );

describe("bucketForDaysUntil", () => {
  test.each<[number, string | null]>([
    [-30, "overdue"],
    [-1, "overdue"],
    [0, "today"],
    [1, "1d"],
    [2, "7d"],
    [7, "7d"],
    [8, null],
    [40, null],
  ])("%i days → %s", (days, token) => {
    expect(bucketForDaysUntil(days)?.dueToken ?? null).toBe(token);
  });
});

describe("runDeadlineNotificationSweep — buckets (calendar days)", () => {
  test("deadline due within 7 days notifies the owner once (7d bucket)", async () => {
    const deadlineId = await seedDeadline({ dueDate: dueIn(5) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(1);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(ownerId);
    expect(rows[0]!.type).toBe("deadline_approaching");
    expect(rows[0]!.title).toContain(
      `within ${DEADLINE_SOON_THRESHOLD_DAYS} days`
    );
    expect(rows[0]!.link).toBe(
      `/matters/${matterId}/deadlines?deadline=${deadlineId}&due=7d&on=2026-07-12`
    );
    expect(rows[0]!.matterId).toBe(matterId);
  });

  test("deadline due tomorrow gets the 1d bucket only (no simultaneous 7d ping)", async () => {
    await seedDeadline({ dueDate: dueIn(1) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(1);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("deadline_approaching");
    expect(rows[0]!.title).toContain(
      `within ${DEADLINE_IMMINENT_THRESHOLD_DAYS} day`
    );
    expect(rows[0]!.link).toContain("due=1d");
  });

  test("a deadline due TODAY is a due-today notice, not overdue (the old instant compare flagged it overdue)", async () => {
    await seedDeadline({ dueDate: dueIn(0) });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("deadline_approaching");
    expect(rows[0]!.title).toContain("due today");
    expect(rows[0]!.link).toContain("due=today");
    expect(rows[0]!.link).toContain("on=2026-07-07");
  });

  test("evening in Denver: due-today is still today, due-tomorrow is still tomorrow", async () => {
    // 2026-07-08T02:00Z = Jul 7, 8 PM in Denver, but already Jul 8 in
    // UTC. Old code: a Jul 7 deadline (00:00Z Jul 7) read as >1 day
    // overdue, and Jul 8 (00:00Z) as already past.
    await seedDeadline({ dueDate: dueIn(0), title: "Due Jul 7" });
    await seedDeadline({ dueDate: dueIn(1), title: "Due Jul 8" });
    await runDeadlineNotificationSweep(new Date("2026-07-08T02:00:00Z"));

    const rows = await prisma.notification.findMany();
    const byTitle = Object.fromEntries(
      rows.map((r) => [r.title, r.link ?? ""])
    );
    expect(rows.every((r) => r.type === "deadline_approaching")).toBe(true);
    expect(byTitle["Deadline due today: Due Jul 7"]).toContain("due=today");
    expect(byTitle["Deadline due within 1 day: Due Jul 8"]).toContain("due=1d");
  });

  test("overdue only once the due day has fully passed in the recipient's zone", async () => {
    await seedDeadline({ dueDate: dueIn(0) });
    // 2026-07-08T05:00Z is still Jul 7 at 11 PM in Denver: a Jul 7
    // deadline is not overdue yet.
    expect(
      (await sweepAt("2026-07-08T05:00:00Z")).created
    ).toBe(1);
    expect(await prisma.notification.count({ where: { type: "deadline_overdue" } })).toBe(0);

    // Denver midnight has passed: now it's overdue.
    await sweepAt("2026-07-08T07:00:00Z");
    const overdue = await prisma.notification.findMany({
      where: { type: "deadline_overdue" },
    });
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.title).toContain("overdue");
    expect(overdue[0]!.link).toContain("due=overdue");
  });

  test("past-due open deadline notifies as deadline_overdue", async () => {
    await seedDeadline({ dueDate: dueIn(-2) });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("deadline_overdue");
    expect(rows[0]!.title).toContain("overdue");
    expect(rows[0]!.link).toContain("due=overdue");
  });

  test("the recipient's own zone decides the day (Auckland is a day ahead of Denver)", async () => {
    await prisma.user.update({
      where: { id: ownerId },
      data: { timeZone: "Pacific/Auckland" },
    });
    // NOW is Jul 7 12:00Z = Jul 8 00:00 in Auckland, so a Jul 8
    // deadline is due TODAY for the owner (it would be "1d" in Denver).
    await seedDeadline({ dueDate: dueIn(1) });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.link).toContain("due=today");
  });

  test("deadline further out than 7 days is silent", async () => {
    await seedDeadline({ dueDate: dueIn(10) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("completed / waived deadlines never notify (even past due)", async () => {
    await seedDeadline({ dueDate: dueIn(-1), status: "completed" });
    await seedDeadline({ dueDate: dueIn(2), status: "waived" });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
  });
});

describe("runDeadlineNotificationSweep — idempotency", () => {
  test("re-running creates nothing new", async () => {
    await seedDeadline({ dueDate: dueIn(5) });
    const first = await runDeadlineNotificationSweep(NOW);
    expect(first.created).toBe(1);

    const second = await runDeadlineNotificationSweep(NOW);
    expect(second.created).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  test("7d, 1d, due-today and overdue are separate one-time events over the deadline's life", async () => {
    // Due Jul 12.
    await seedDeadline({ dueDate: dueIn(5) });

    await sweepAt("2026-07-07T12:00:00Z"); // 5 days out → 7d
    await sweepAt("2026-07-11T12:00:00Z"); // tomorrow → 1d
    await sweepAt("2026-07-12T12:00:00Z"); // due day → today
    await sweepAt("2026-07-13T12:00:00Z"); // day after → overdue
    // And a final re-run creates nothing.
    const last = await sweepAt("2026-07-13T18:00:00Z");
    expect(last.created).toBe(0);

    const rows = await prisma.notification.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.type).sort()).toEqual([
      "deadline_approaching",
      "deadline_approaching",
      "deadline_approaching",
      "deadline_overdue",
    ]);
    expect(new Set(rows.map((r) => r.link)).size).toBe(4);
  });

  test("a rescheduled deadline (extension / SOL correction) is notified again", async () => {
    const id = await seedDeadline({ dueDate: dueIn(5) }); // Jul 12
    await sweepAt("2026-07-07T12:00:00Z"); // 7d for Jul 12
    await sweepAt("2026-07-13T12:00:00Z"); // overdue for Jul 12

    // The court extends the deadline to Jul 30 (edited in place — same id).
    await prisma.deadline.update({
      where: { id },
      data: { dueDate: parseDateOnly("2026-07-30")! },
    });

    // A week before the NEW date the 7d notice must fire again, and
    // so must the later buckets for the new date.
    expect((await sweepAt("2026-07-24T12:00:00Z")).created).toBe(1);
    expect((await sweepAt("2026-07-31T12:00:00Z")).created).toBe(1);
    // Re-runs stay quiet.
    expect((await sweepAt("2026-07-31T13:00:00Z")).created).toBe(0);

    const rows = await prisma.notification.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.link?.match(/on=([\d-]+)/)?.[1])).toEqual([
      "2026-07-12",
      "2026-07-12",
      "2026-07-30",
      "2026-07-30",
    ]);
  });

  test("overlapping runs do not double-write", async () => {
    await seedDeadline({ dueDate: dueIn(3) });
    await seedDeadline({ dueDate: dueIn(-2), title: "Late" });

    const results = await Promise.all([
      runDeadlineNotificationSweep(NOW),
      runDeadlineNotificationSweep(NOW),
      runDeadlineNotificationSweep(NOW),
    ]);

    expect(results.reduce((n, r) => n + r.created, 0)).toBe(2);
    expect(await prisma.notification.count()).toBe(2);
  });
});

describe("runDeadlineNotificationSweep — recipients", () => {
  test("ownerless deadline fans out to every ACTIVE team member", async () => {
    // A removed member must not be pinged.
    const gone = await seedUser({ firmId, email: "gone@example.com" });
    await prisma.matterTeamMember.create({
      data: {
        matterId,
        userId: gone.userId,
        role: "co_counsel",
        removedAt: new Date(),
      },
    });

    await seedDeadline({ dueDate: dueIn(3), ownerId: null });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(2);

    const rows = await prisma.notification.findMany();
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([ownerId, teammateId])
    );
  });

  test("owned deadline notifies only the owner", async () => {
    await seedDeadline({ dueDate: dueIn(3), ownerId: teammateId });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(teammateId);
  });

  test("a deactivated owner doesn't swallow the notice: the active team gets it", async () => {
    await prisma.user.update({
      where: { id: teammateId },
      data: { isActive: false },
    });
    const departed = await seedUser({
      firmId,
      email: "departed@example.com",
      isActive: false,
    });
    const another = await seedUser({ firmId, email: "another@example.com" });
    await prisma.matterTeamMember.createMany({
      data: [
        { matterId, userId: departed.userId, role: "associate" },
        { matterId, userId: another.userId, role: "paralegal" },
      ],
    });
    await seedDeadline({ dueDate: dueIn(3), ownerId: departed.userId });

    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    // Team = owner(lead) + another; the deactivated teammate and the
    // deactivated owner are skipped.
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([ownerId, another.userId])
    );
  });

  test("deactivated team members are skipped on ownerless deadlines", async () => {
    await prisma.user.update({
      where: { id: teammateId },
      data: { isActive: false },
    });
    await seedDeadline({ dueDate: dueIn(3), ownerId: null });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows.map((r) => r.userId)).toEqual([ownerId]);
  });

  test("archived matters are skipped", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    await seedDeadline({ dueDate: dueIn(2) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
  });
});

describe("maybeRunDeadlineNotificationSweep — hourly throttle", () => {
  test("second call within the interval is skipped; after it, runs again", async () => {
    await seedDeadline({ dueDate: dueIn(5) });

    const first = await maybeRunDeadlineNotificationSweep(NOW);
    expect(first.ran).toBe(true);
    expect(first.created).toBe(1);

    const second = await maybeRunDeadlineNotificationSweep(
      new Date(NOW.getTime() + SWEEP_MIN_INTERVAL_MS - 1)
    );
    expect(second.ran).toBe(false);

    const third = await maybeRunDeadlineNotificationSweep(
      new Date(NOW.getTime() + SWEEP_MIN_INTERVAL_MS + 1)
    );
    expect(third.ran).toBe(true);
    // Idempotency still holds across the throttle boundary.
    expect(third.created).toBe(0);
  });

  test("never throws — sweep failures are swallowed with a warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("boom"));
    const result = await maybeRunDeadlineNotificationSweep(NOW);
    expect(result.ran).toBe(true);
    expect(result.created).toBe(0);
    expect(warn).toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });
});

// Regression: the dashboard runs the sweep during page render, where
// Next refuses revalidatePath (it used to throw-and-warn every load).
describe("runDeadlineNotificationSweep — cache revalidation is opt-in", () => {
  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
  });

  test("the throttled dashboard path never revalidates", async () => {
    resetSweepThrottleForTests();
    await seedDeadline({ dueDate: new Date(dueIn(0).getTime() + 3 * DAY_MS) });
    const result = await maybeRunDeadlineNotificationSweep(NOW);
    expect(result.created).toBeGreaterThan(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("the cron path revalidates when it created notifications", async () => {
    await seedDeadline({ dueDate: dueIn(3) });
    const result = await runDeadlineNotificationSweep(NOW, { revalidate: true });
    expect(result.created).toBeGreaterThan(0);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test("the cron path does not revalidate when nothing new was written", async () => {
    await seedDeadline({ dueDate: dueIn(3) });
    await runDeadlineNotificationSweep(NOW);
    vi.mocked(revalidatePath).mockClear();
    await runDeadlineNotificationSweep(NOW, { revalidate: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
