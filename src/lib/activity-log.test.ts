/**
 * Integration tests for the activity-log writer.
 *
 * `logActivity` hits the DB (creates an `ActivityLog` row) and
 * `revalidatePath`s the dashboard. The tests stub revalidatePath
 * but use the real test DB so the row write + default icon/source
 * fallbacks are covered end-to-end.
 *
 * The fire-and-forget contract is the most important behavior: a
 * failed write must NEVER throw out of `logActivity`. We force a
 * write failure by passing a non-existent userId (FK violation)
 * and assert the call resolves cleanly.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedRevalidate = vi.mocked(revalidatePath);

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("logActivity — happy path", () => {
  test("writes a row + revalidates the dashboard", async () => {
    await logActivity({
      matterId,
      userId,
      type: "note",
      title: "Note created",
      detail: "First impressions",
    });

    const rows = await prisma.activityLog.findMany({ where: { matterId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("note");
    expect(rows[0]!.title).toBe("Note created");
    expect(rows[0]!.detail).toBe("First impressions");
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  test("accepts a null matterId (firm-level activity)", async () => {
    await logActivity({
      matterId: null,
      userId,
      type: "automation",
      title: "Nightly sweep",
    });

    const rows = await prisma.activityLog.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matterId).toBeNull();
  });

  test("normalizes missing detail to null", async () => {
    await logActivity({
      matterId,
      userId,
      type: "task",
      title: "Open task",
    });
    const row = await prisma.activityLog.findFirst({ where: { matterId } });
    expect(row!.detail).toBeNull();
  });
});

describe("logActivity — default icon mapping", () => {
  test.each<[string, string]>([
    ["note", "note"],
    ["task", "check"],
    ["task_complete", "check"],
    ["deadline", "gavel"],
    ["time_entry", "clock"],
    ["event", "video"],
    ["email", "mail"],
    ["document", "document"],
    ["filing", "document"],
    ["evidence", "zap"], // fallthrough
    ["settlement", "zap"],
    ["deposit", "zap"],
    ["automation", "zap"],
    ["deposition", "zap"],
  ])("type=%s → icon=%s when unspecified", async (type, icon) => {
    await logActivity({
      matterId,
      userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: type as any,
      title: `t-${type}`,
    });
    const row = await prisma.activityLog.findFirst({
      where: { title: `t-${type}` },
    });
    expect(row!.icon).toBe(icon);
  });

  test("explicit icon overrides the default", async () => {
    await logActivity({
      matterId,
      userId,
      type: "note",
      title: "custom-icon",
      icon: "sparkle",
    });
    const row = await prisma.activityLog.findFirst({
      where: { title: "custom-icon" },
    });
    expect(row!.icon).toBe("sparkle");
  });
});

describe("logActivity — default source mapping", () => {
  test.each<[string, string]>([
    ["note", "Notes"],
    ["task", "Tasks"],
    ["task_complete", "Tasks"],
    ["deadline", "Deadlines"],
    ["time_entry", "Time"],
    ["event", "Calendar"],
    ["email", "Email"],
    ["document", "Documents"],
    ["filing", "Documents"],
    ["settlement", "System"], // fallthrough
    ["evidence", "System"],
    ["automation", "System"],
  ])("type=%s → source=%s when unspecified", async (type, source) => {
    await logActivity({
      matterId,
      userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: type as any,
      title: `s-${type}`,
    });
    const row = await prisma.activityLog.findFirst({
      where: { title: `s-${type}` },
    });
    expect(row!.source).toBe(source);
  });

  test("explicit source overrides the default", async () => {
    await logActivity({
      matterId,
      userId,
      type: "task",
      title: "custom-source",
      source: "Workflow",
    });
    const row = await prisma.activityLog.findFirst({
      where: { title: "custom-source" },
    });
    expect(row!.source).toBe("Workflow");
  });
});

describe("logActivity — fire-and-forget on failure", () => {
  test("swallows DB errors so the user's action stays the source of truth", async () => {
    // FK violation: nonexistent userId. The write fails; the call
    // must NOT throw — observability is best-effort.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      logActivity({
        matterId,
        userId: "no-such-user",
        type: "note",
        title: "doomed",
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
