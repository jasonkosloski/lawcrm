/**
 * Integration tests for the notification mutating actions.
 *
 * Both `markNotificationRead` and `markAllNotificationsRead` are
 * scoped to the current user — the where-clause includes userId
 * so a guessed id can't flip another user's row. These tests pin
 * that scoping in place.
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
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let otherUserId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
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
