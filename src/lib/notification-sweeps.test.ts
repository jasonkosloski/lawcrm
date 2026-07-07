/**
 * Integration tests for the deadline notification sweep.
 *
 * The load-bearing property is idempotency: the sweep is invoked
 * from every dashboard load AND a platform cron, so re-running it
 * must never duplicate a notice. Each (userId, type, link) triple —
 * with the threshold encoded in the link's `due` param — is a
 * one-time event: the 7-day notice, the 1-day notice, and the
 * overdue notice for the same deadline are three separate rows that
 * each fire exactly once.
 *
 * Also covered: recipient resolution (owner vs. active-team
 * fan-out), window edges (due > 7 days = silence), skips for
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

import { prisma } from "@/lib/prisma";
import {
  DEADLINE_IMMINENT_THRESHOLD_DAYS,
  DEADLINE_SOON_THRESHOLD_DAYS,
  SWEEP_MIN_INTERVAL_MS,
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
const NOW = new Date("2026-07-07T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

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
      dueDate: over?.dueDate ?? inDays(5),
      ownerId: over?.ownerId === undefined ? ownerId : over.ownerId,
      status: over?.status ?? "open",
    },
    select: { id: true },
  });
  return d.id;
};

describe("runDeadlineNotificationSweep — buckets", () => {
  test("deadline due within 7 days notifies the owner once (7d bucket)", async () => {
    const deadlineId = await seedDeadline({ dueDate: inDays(5) });
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
      `/matters/${matterId}/deadlines?deadline=${deadlineId}&due=7d`
    );
    expect(rows[0]!.matterId).toBe(matterId);
  });

  test("deadline due within 1 day gets the 1d bucket only (no simultaneous 7d ping)", async () => {
    await seedDeadline({ dueDate: inDays(0.5) });
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

  test("past-due open deadline notifies as deadline_overdue", async () => {
    await seedDeadline({ dueDate: inDays(-2) });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("deadline_overdue");
    expect(rows[0]!.title).toContain("overdue");
    expect(rows[0]!.link).toContain("due=overdue");
  });

  test("deadline further out than 7 days is silent", async () => {
    await seedDeadline({ dueDate: inDays(10) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("completed / waived deadlines never notify (even past due)", async () => {
    await seedDeadline({ dueDate: inDays(-1), status: "completed" });
    await seedDeadline({ dueDate: inDays(2), status: "waived" });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
  });
});

describe("runDeadlineNotificationSweep — idempotency", () => {
  test("re-running creates nothing new", async () => {
    await seedDeadline({ dueDate: inDays(5) });
    const first = await runDeadlineNotificationSweep(NOW);
    expect(first.created).toBe(1);

    const second = await runDeadlineNotificationSweep(NOW);
    expect(second.created).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  test("7d and 1d notices are separate one-time events over the deadline's life", async () => {
    await seedDeadline({ dueDate: inDays(5) });

    // Seen at T: 7d notice fires.
    await runDeadlineNotificationSweep(NOW);
    // Seen again at T+4.5 days (12h out): 1d notice fires — the
    // earlier 7d row doesn't block it because the link differs.
    await runDeadlineNotificationSweep(new Date(NOW.getTime() + 4.5 * DAY_MS));
    // Seen at T+6 days (past due): overdue notice fires once.
    await runDeadlineNotificationSweep(new Date(NOW.getTime() + 6 * DAY_MS));
    // And a final re-run creates nothing.
    const last = await runDeadlineNotificationSweep(
      new Date(NOW.getTime() + 6 * DAY_MS)
    );
    expect(last.created).toBe(0);

    const rows = await prisma.notification.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.type)).toEqual([
      "deadline_approaching",
      "deadline_approaching",
      "deadline_overdue",
    ]);
    expect(new Set(rows.map((r) => r.link)).size).toBe(3);
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

    await seedDeadline({ dueDate: inDays(3), ownerId: null });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(2);

    const rows = await prisma.notification.findMany();
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([ownerId, teammateId])
    );
  });

  test("owned deadline notifies only the owner", async () => {
    await seedDeadline({ dueDate: inDays(3), ownerId: teammateId });
    await runDeadlineNotificationSweep(NOW);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(teammateId);
  });

  test("archived matters are skipped", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    await seedDeadline({ dueDate: inDays(2) });
    const result = await runDeadlineNotificationSweep(NOW);
    expect(result.created).toBe(0);
  });
});

describe("maybeRunDeadlineNotificationSweep — hourly throttle", () => {
  test("second call within the interval is skipped; after it, runs again", async () => {
    await seedDeadline({ dueDate: inDays(5) });

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
      .spyOn(prisma.deadline, "findMany")
      .mockRejectedValueOnce(new Error("boom"));
    const result = await maybeRunDeadlineNotificationSweep(NOW);
    expect(result.ran).toBe(true);
    expect(result.created).toBe(0);
    expect(warn).toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });
});
