/**
 * Integration tests for the thread mark-as-read actions.
 *
 * Pins the two channel-specific read models:
 *   - Email: `EmailThread.isRead` only, scoped to the caller's own
 *     mailboxes — another user's thread is a silent no-op.
 *   - Messenger: item flags + the denormalized `unreadCount` flip
 *     together (transaction), including the drift case where the
 *     counter says unread but every item row is already read.
 *
 * Both actions must no-op WITHOUT revalidating when already read —
 * the island fires on every thread open, so a useless revalidation
 * would re-render the inbox on every click.
 *
 * Gmail writeback (v1.1): `gmail-writeback` is mocked — its
 * never-rejects contract has its own suite. Here we pin WHEN it
 * fires (first read of an externalId-bearing thread, `remove
 * UNREAD`) and when it must not (no-op re-read, local-only thread,
 * foreign thread).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/google/gmail-writeback", () => ({
  writebackGmailThread: vi.fn().mockResolvedValue(undefined),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { writebackGmailThread } from "@/lib/google/gmail-writeback";
import { prisma } from "@/lib/prisma";
import {
  markEmailThreadRead,
  markMessengerThreadRead,
} from "@/app/actions/thread-read";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedWriteback = vi.mocked(writebackGmailThread);

let userId: string;
let otherUserId: string;
let matterId: string;
let myAccountId: string;
let emailThreadId: string;
let gmailThreadId: string; // mine, with an externalId (Gmail-synced)
let otherUsersThreadId: string;
let messengerThreadId: string;

/** Unread messenger item fixture on the shared thread. */
async function seedItem(opts?: { isRead?: boolean }): Promise<string> {
  const item = await prisma.messengerItem.create({
    data: {
      threadId: messengerThreadId,
      providerEventId: `evt-${Math.random().toString(36).slice(2)}`,
      kind: "sms",
      direction: "inbound",
      fromNumber: "+13035550182",
      toNumber: "+13035551234",
      body: "hello",
      isRead: opts?.isRead ?? false,
      occurredAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  return item.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  const other = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = other.userId;
  mockedGetUser.mockResolvedValue(userId);

  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;

  // One mailbox per user, one unread thread in each — the cross-user
  // test targets `otherUsersThreadId` while signed in as `userId`.
  const [mine, theirs] = await Promise.all([
    prisma.emailAccount.create({
      data: { userId, emailAddress: "me@example.com" },
      select: { id: true },
    }),
    prisma.emailAccount.create({
      data: { userId: otherUserId, emailAddress: "them@example.com" },
      select: { id: true },
    }),
  ]);
  myAccountId = mine.id;
  const [t1, t2, t3] = await Promise.all([
    prisma.emailThread.create({
      data: {
        accountId: mine.id,
        matterId,
        subject: "Re: discovery deadline",
        isRead: false,
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    }),
    prisma.emailThread.create({
      data: {
        accountId: theirs.id,
        externalId: "gt-theirs",
        subject: "Privileged — settlement strategy",
        isRead: false,
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    }),
    prisma.emailThread.create({
      data: {
        accountId: mine.id,
        externalId: "gt-read-1",
        subject: "Gmail-synced thread",
        isRead: false,
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    }),
  ]);
  emailThreadId = t1.id;
  otherUsersThreadId = t2.id;
  gmailThreadId = t3.id;

  // Firm-shared messenger line (userId null) + one thread on it.
  const line = await prisma.messengerAccount.create({
    data: { phoneNumber: "+13035551234" },
    select: { id: true },
  });
  const mt = await prisma.messengerThread.create({
    data: {
      accountId: line.id,
      contactPhone: "+13035550182",
      defaultMatterId: matterId,
      lastItemAt: new Date("2026-06-01T10:00:00Z"),
      unreadCount: 0,
    },
    select: { id: true },
  });
  messengerThreadId = mt.id;
});

describe("markEmailThreadRead", () => {
  test("flips isRead + revalidates the unread surfaces", async () => {
    const res = await markEmailThreadRead(emailThreadId);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { isRead: true },
    });
    expect(thread.isRead).toBe(true);

    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
    expect(mockedRevalidate).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
    expect(mockedRevalidate).toHaveBeenCalledWith(
      "/intake/[id]/communication",
      "page"
    );
  });

  test("already-read thread no-ops without revalidating", async () => {
    await markEmailThreadRead(emailThreadId);
    mockedRevalidate.mockClear();

    const res = await markEmailThreadRead(emailThreadId);
    expect(res).toEqual({ ok: true });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  test("Gmail-synced thread fires writeback removing UNREAD after the local flip", async () => {
    const res = await markEmailThreadRead(gmailThreadId);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: gmailThreadId },
      select: { isRead: true },
    });
    expect(thread.isRead).toBe(true);
    expect(mockedWriteback).toHaveBeenCalledExactlyOnceWith(
      myAccountId,
      "gt-read-1",
      { removeLabelIds: ["UNREAD"] }
    );
  });

  test("no-op re-read fires NO writeback", async () => {
    await markEmailThreadRead(gmailThreadId);
    mockedWriteback.mockClear();

    await markEmailThreadRead(gmailThreadId);
    expect(mockedWriteback).not.toHaveBeenCalled();
  });

  test("thread without an externalId (local-only) fires NO writeback", async () => {
    await markEmailThreadRead(emailThreadId);
    expect(mockedWriteback).not.toHaveBeenCalled();
  });

  test("cannot flip a thread in another user's mailbox", async () => {
    // Signed in as `userId`, targeting the other user's thread —
    // silent no-op, row untouched, nothing revalidated, no writeback.
    const res = await markEmailThreadRead(otherUsersThreadId);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: otherUsersThreadId },
      select: { isRead: true },
    });
    expect(thread.isRead).toBe(false);
    expect(mockedRevalidate).not.toHaveBeenCalled();
    expect(mockedWriteback).not.toHaveBeenCalled();
  });

  test("throws (login redirect) before writing when there is no session", async () => {
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(markEmailThreadRead(emailThreadId)).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { isRead: true },
    });
    expect(thread.isRead).toBe(false);
  });
});

describe("markMessengerThreadRead", () => {
  test("flips every unread item AND zeroes the denormalized counter", async () => {
    const unread1 = await seedItem();
    const unread2 = await seedItem();
    const alreadyRead = await seedItem({ isRead: true });
    await prisma.messengerThread.update({
      where: { id: messengerThreadId },
      data: { unreadCount: 2 },
    });

    const res = await markMessengerThreadRead(messengerThreadId);
    expect(res).toEqual({ ok: true });

    const items = await prisma.messengerItem.findMany({
      where: { id: { in: [unread1, unread2, alreadyRead] } },
      select: { isRead: true },
    });
    expect(items.every((i) => i.isRead)).toBe(true);

    const thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: messengerThreadId },
      select: { unreadCount: true },
    });
    expect(thread.unreadCount).toBe(0);

    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
    expect(mockedRevalidate).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
    expect(mockedRevalidate).toHaveBeenCalledWith(
      "/intake/[id]/communication",
      "page"
    );
  });

  test("already-read thread no-ops without revalidating", async () => {
    await seedItem({ isRead: true });
    // unreadCount is already 0 per fixture — the fully-read state.
    const res = await markMessengerThreadRead(messengerThreadId);
    expect(res).toEqual({ ok: true });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  test("heals counter drift: unreadCount > 0 with zero unread items still resets", async () => {
    await seedItem({ isRead: true });
    await prisma.messengerThread.update({
      where: { id: messengerThreadId },
      data: { unreadCount: 3 }, // stale badge, no actual unread rows
    });

    await markMessengerThreadRead(messengerThreadId);

    const thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: messengerThreadId },
      select: { unreadCount: true },
    });
    expect(thread.unreadCount).toBe(0);
    // The badge changed, so surfaces DO revalidate here.
    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
  });

  test("unknown thread id reads as not found", async () => {
    const res = await markMessengerThreadRead("nonexistent-thread-id");
    expect(res).toEqual({ ok: false });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  test("throws (login redirect) before writing when there is no session", async () => {
    const itemId = await seedItem();
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      markMessengerThreadRead(messengerThreadId)
    ).rejects.toThrow("NEXT_REDIRECT");

    const item = await prisma.messengerItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { isRead: true },
    });
    expect(item.isRead).toBe(false);
  });
});
