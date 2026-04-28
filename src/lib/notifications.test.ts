/**
 * Integration tests for the notifications writer + the bell read.
 *
 * Covers:
 *   - createNotification persists the row + revalidates
 *   - createNotifications fans out, dedupes recipients, no-ops
 *     on empty input
 *   - getNotificationsBell returns the unread count + recent
 *     unread first then a tail of read entries
 *   - Fire-and-forget: writes that fail at the DB layer are
 *     swallowed so the user's primary action stays the source
 *     of truth (mirrors the activity-log contract).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createNotification,
  createNotifications,
} from "@/lib/notifications";
import { getNotificationsBell } from "@/lib/queries/notifications";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRevalidate = vi.mocked(revalidatePath);

let firmId: string;
let userId: string;
let otherUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId, email: "primary@example.com" });
  userId = u.userId;
  const u2 = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);
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

describe("createNotification", () => {
  test("writes a row + revalidates the layout", async () => {
    await createNotification({
      userId,
      type: "matter_assigned",
      title: "Welcome to Acme v Beta",
      body: "You're co-counsel.",
      link: `/matters/${matterId}`,
      matterId,
    });

    const rows = await prisma.notification.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Welcome to Acme v Beta");
    expect(rows[0]!.body).toBe("You're co-counsel.");
    expect(rows[0]!.matterId).toBe(matterId);
    expect(rows[0]!.readAt).toBeNull();
    expect(mockedRevalidate).toHaveBeenCalledWith("/", "layout");
  });

  test("normalizes optional fields to null", async () => {
    await createNotification({
      userId,
      type: "generic",
      title: "Heads up",
    });
    const row = await prisma.notification.findFirst({ where: { userId } });
    expect(row!.body).toBeNull();
    expect(row!.link).toBeNull();
    expect(row!.matterId).toBeNull();
  });

  test("swallows errors (fire-and-forget)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Bad userId — FK violation. Promise should still resolve.
    await expect(
      createNotification({
        userId: "no-such-user",
        type: "generic",
        title: "Doomed",
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createNotifications (fan-out)", () => {
  test("creates one row per unique recipient", async () => {
    await createNotifications([userId, otherUserId], {
      type: "settlement_step_approved",
      title: "Partner sign-off recorded",
      matterId,
    });
    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([userId, otherUserId])
    );
  });

  test("dedupes duplicate recipients", async () => {
    await createNotifications([userId, userId, userId], {
      type: "generic",
      title: "Once please",
    });
    const rows = await prisma.notification.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
  });

  test("no-ops on empty recipients (no DB call, no revalidate)", async () => {
    mockedRevalidate.mockClear();
    await createNotifications([], { type: "generic", title: "" });
    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(0);
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});

describe("getNotificationsBell", () => {
  test("unreadCount reflects unread rows only", async () => {
    await prisma.notification.createMany({
      data: [
        { userId, type: "generic", title: "u1" },
        { userId, type: "generic", title: "u2" },
        { userId, type: "generic", title: "r1", readAt: new Date() },
      ],
    });
    const bell = await getNotificationsBell();
    expect(bell.unreadCount).toBe(2);
  });

  test("recent puts unread first then read tail", async () => {
    // Sleep-isolated timestamps so ordering is deterministic.
    const t = (offsetMs: number) => new Date(Date.now() - offsetMs);
    await prisma.notification.createMany({
      data: [
        // 3 unread
        { userId, type: "generic", title: "unread-1", createdAt: t(1000) },
        { userId, type: "generic", title: "unread-2", createdAt: t(2000) },
        { userId, type: "generic", title: "unread-3", createdAt: t(3000) },
        // 2 read (most recent first by createdAt)
        {
          userId,
          type: "generic",
          title: "read-newer",
          createdAt: t(500),
          readAt: t(100),
        },
        {
          userId,
          type: "generic",
          title: "read-older",
          createdAt: t(10_000),
          readAt: t(5_000),
        },
      ],
    });
    const bell = await getNotificationsBell();
    expect(bell.unreadCount).toBe(3);
    // First three are unread (newest first), then read tail.
    expect(bell.recent.slice(0, 3).map((r) => r.title)).toEqual([
      "unread-1",
      "unread-2",
      "unread-3",
    ]);
    expect(bell.recent.slice(3, 5).map((r) => r.title)).toEqual([
      "read-newer",
      "read-older",
    ]);
    expect(bell.recent[0]!.isRead).toBe(false);
    expect(bell.recent[3]!.isRead).toBe(true);
  });

  test("bell is per-user (other users' rows don't leak)", async () => {
    await prisma.notification.create({
      data: { userId: otherUserId, type: "generic", title: "for them" },
    });
    const bell = await getNotificationsBell();
    expect(bell.unreadCount).toBe(0);
    expect(bell.recent).toHaveLength(0);
  });

  test("includes matterName for rows with a matterId", async () => {
    await createNotification({
      userId,
      type: "matter_assigned",
      title: "Linked",
      matterId,
    });
    const bell = await getNotificationsBell();
    expect(bell.recent[0]!.matterName).not.toBeNull();
    expect(bell.recent[0]!.matterId).toBe(matterId);
  });
});
