/**
 * Integration tests for the sidebar aggregate.
 *
 * Pins the unread-email badge: it counts the viewer's OWN mailbox
 * only (never coworkers' unread volume) and excludes archived
 * threads.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn().mockResolvedValue(false),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getSidebarData } from "@/lib/queries/sidebar";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let aId: string;
let bId: string;
let seq = 0;

async function seedThreads(
  ownerId: string,
  opts: { unread: number; archivedUnread?: number; read?: number }
) {
  const account = await prisma.emailAccount.create({
    data: { userId: ownerId, emailAddress: `box-${++seq}@firm.test` },
    select: { id: true },
  });
  const mk = (isRead: boolean, isArchived: boolean) =>
    prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "t",
        isRead,
        isArchived,
        lastMessageAt: new Date("2026-07-01T12:00:00Z"),
      },
    });
  for (let i = 0; i < opts.unread; i++) await mk(false, false);
  for (let i = 0; i < (opts.archivedUnread ?? 0); i++) await mk(false, true);
  for (let i = 0; i < (opts.read ?? 0); i++) await mk(true, false);
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: aId } = await seedUser({ firmId, name: "User A" }));
  ({ userId: bId } = await seedUser({ firmId, name: "User B" }));
});

describe("getSidebarData — unreadEmailCount", () => {
  test("counts only the viewer's own mailbox", async () => {
    await seedThreads(aId, { unread: 30 });
    await seedThreads(bId, { unread: 2 });

    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(2);

    mockedGetUser.mockResolvedValue(aId);
    expect((await getSidebarData()).unreadEmailCount).toBe(30);
  });

  test("is zero for a user with no connected mailbox, whatever others hold", async () => {
    await seedThreads(aId, { unread: 5 });
    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(0);
  });

  test("excludes archived and already-read threads", async () => {
    await seedThreads(bId, { unread: 3, archivedUnread: 4, read: 6 });
    mockedGetUser.mockResolvedValue(bId);
    expect((await getSidebarData()).unreadEmailCount).toBe(3);
  });
});
