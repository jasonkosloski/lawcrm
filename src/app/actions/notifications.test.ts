/**
 * Integration tests for the notification mutating actions + the
 * /notifications feed query.
 *
 * Both `markNotificationRead` and `markAllNotificationsRead` are
 * scoped to the current user — the where-clause includes userId
 * so a guessed id can't flip another user's row. These tests pin
 * that scoping in place.
 *
 * `getNotificationsFeed` drives the full feed page: newest-first
 * offset pagination at NOTIFICATIONS_PAGE_SIZE/page, page clamping
 * for junk ?page= values, per-row isRead + the unread counter.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/actions/notifications";
import {
  getNotificationsFeed,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/lib/queries/notifications";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let otherUserId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "primary@example.com" });
  userId = u.userId;
  const u2 = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("markNotificationRead", () => {
  test("flips readAt + returns ok", async () => {
    const n = await prisma.notification.create({
      data: { userId, type: "generic", title: "Unread" },
      select: { id: true },
    });
    const res = await markNotificationRead(n.id);
    expect(res.ok).toBe(true);
    const row = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(row!.readAt).not.toBeNull();
  });

  test("refuses to flip another user's row", async () => {
    const n = await prisma.notification.create({
      data: { userId: otherUserId, type: "generic", title: "Theirs" },
      select: { id: true },
    });
    // Current user is `userId` per beforeEach. A guessed id should
    // be a no-op — readAt stays null.
    await markNotificationRead(n.id);
    const row = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(row!.readAt).toBeNull();
  });

  test("already-read row stays at its original timestamp", async () => {
    const original = new Date("2026-01-01T00:00:00Z");
    const n = await prisma.notification.create({
      data: { userId, type: "generic", title: "Already", readAt: original },
      select: { id: true },
    });
    await markNotificationRead(n.id);
    const row = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(row!.readAt!.getTime()).toBe(original.getTime());
  });
});

describe("markAllNotificationsRead", () => {
  test("flips every unread row for the current user", async () => {
    await prisma.notification.createMany({
      data: [
        { userId, type: "generic", title: "u1" },
        { userId, type: "generic", title: "u2" },
        { userId, type: "generic", title: "r1", readAt: new Date() },
      ],
    });
    await markAllNotificationsRead();
    const remaining = await prisma.notification.count({
      where: { userId, readAt: null },
    });
    expect(remaining).toBe(0);
  });

  test("doesn't touch other users' unread rows", async () => {
    await prisma.notification.create({
      data: { userId: otherUserId, type: "generic", title: "Theirs" },
    });
    await markAllNotificationsRead();
    const theirs = await prisma.notification.count({
      where: { userId: otherUserId, readAt: null },
    });
    expect(theirs).toBe(1);
  });
});

describe("getNotificationsFeed", () => {
  test("paginates newest-first at NOTIFICATIONS_PAGE_SIZE per page", async () => {
    // PAGE_SIZE + 5 rows → 2 pages, distinct createdAt so the order
    // is deterministic (n-0 newest).
    const base = Date.now();
    await prisma.notification.createMany({
      data: Array.from({ length: NOTIFICATIONS_PAGE_SIZE + 5 }, (_, i) => ({
        userId,
        type: "generic",
        title: `n-${i}`,
        createdAt: new Date(base - i * 1000),
      })),
    });

    const page1 = await getNotificationsFeed(1);
    expect(page1.total).toBe(NOTIFICATIONS_PAGE_SIZE + 5);
    expect(page1.pageCount).toBe(2);
    expect(page1.rows).toHaveLength(NOTIFICATIONS_PAGE_SIZE);
    expect(page1.rows[0]!.title).toBe("n-0");
    expect(page1.rows[NOTIFICATIONS_PAGE_SIZE - 1]!.title).toBe(
      `n-${NOTIFICATIONS_PAGE_SIZE - 1}`
    );

    const page2 = await getNotificationsFeed(2);
    expect(page2.rows).toHaveLength(5);
    expect(page2.rows[0]!.title).toBe(`n-${NOTIFICATIONS_PAGE_SIZE}`);
    expect(page2.rows[4]!.title).toBe(`n-${NOTIFICATIONS_PAGE_SIZE + 4}`);
  });

  test("clamps junk and out-of-range page values", async () => {
    await prisma.notification.create({
      data: { userId, type: "generic", title: "only" },
    });
    expect((await getNotificationsFeed(99)).page).toBe(1);
    expect((await getNotificationsFeed(-3)).page).toBe(1);
    expect((await getNotificationsFeed(Number("garbage"))).page).toBe(1);
  });

  test("reports per-row isRead + the unread count, scoped to the user", async () => {
    await prisma.notification.createMany({
      data: [
        { userId, type: "generic", title: "unread-one" },
        { userId, type: "generic", title: "read-one", readAt: new Date() },
        { userId: otherUserId, type: "generic", title: "not-mine" },
      ],
    });

    const feed = await getNotificationsFeed(1);
    expect(feed.total).toBe(2);
    expect(feed.unreadCount).toBe(1);
    const byTitle = Object.fromEntries(
      feed.rows.map((r) => [r.title, r.isRead])
    );
    expect(byTitle["unread-one"]).toBe(false);
    expect(byTitle["read-one"]).toBe(true);
    expect(byTitle["not-mine"]).toBeUndefined();
  });
});
