/**
 * Integration tests for the follow-up snooze actions.
 *
 * Covers:
 *   - happy path: set + clear followUpAt on email + messenger threads
 *   - end-of-day semantics (a "by Friday" snooze survives all of Friday)
 *   - invalid date string → error, no write
 *   - AUTH: email threads are scoped to the caller's own mailboxes —
 *     another user's thread reads as "not found" and stays untouched
 *   - AUTH: no session (getCurrentUserId throws its login redirect)
 *     → the action throws before any write lands
 *
 * Messenger deliberately has no cross-user case: the messenger inbox
 * is firm-wide (MessengerAccount.userId is nullable / shared), so any
 * signed-in user may snooze any thread — pinned by the happy path.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  setEmailThreadFollowUp,
  setMessengerThreadFollowUp,
} from "@/app/actions/follow-ups";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let otherUserId: string;
let emailThreadId: string;
let otherUsersThreadId: string;
let messengerThreadId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  const other = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = other.userId;
  mockedGetUser.mockResolvedValue(userId);

  // One mailbox per user, one thread in each — the cross-user test
  // targets `otherUsersThreadId` while signed in as `userId`.
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
  const [t1, t2] = await Promise.all([
    prisma.emailThread.create({
      data: {
        accountId: mine.id,
        subject: "Re: discovery deadline",
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    }),
    prisma.emailThread.create({
      data: {
        accountId: theirs.id,
        subject: "Privileged — settlement strategy",
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    }),
  ]);
  emailThreadId = t1.id;
  otherUsersThreadId = t2.id;

  // Firm-shared messenger line (userId null) + one thread on it.
  const line = await prisma.messengerAccount.create({
    data: { phoneNumber: "+13035551234" },
    select: { id: true },
  });
  const mt = await prisma.messengerThread.create({
    data: {
      accountId: line.id,
      contactPhone: "+13035550182",
      lastItemAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  messengerThreadId = mt.id;
});

describe("setEmailThreadFollowUp", () => {
  test("sets followUpAt to end of the given day on the caller's own thread", async () => {
    const result = await setEmailThreadFollowUp(emailThreadId, "2026-06-12");
    expect(result).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { followUpAt: true },
    });
    // End-of-day (local): a "by Friday" follow-up stays active all Friday.
    expect(thread.followUpAt).toEqual(
      new Date(2026, 5, 12, 23, 59, 59, 999)
    );
  });

  test("clears followUpAt when passed null", async () => {
    await setEmailThreadFollowUp(emailThreadId, "2026-06-12");
    const result = await setEmailThreadFollowUp(emailThreadId, null);
    expect(result).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });

  test("rejects a malformed date string without writing", async () => {
    const result = await setEmailThreadFollowUp(emailThreadId, "next tuesday");
    expect(result).toEqual({ ok: false, error: "Invalid date" });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });

  test("cannot touch a thread in another user's mailbox", async () => {
    // Signed in as `userId`, targeting the other user's thread — must
    // read as not-found (indistinguishable from a nonexistent id) and
    // leave the row untouched.
    const result = await setEmailThreadFollowUp(
      otherUsersThreadId,
      "2026-06-12"
    );
    expect(result).toEqual({ ok: false, error: "Thread not found" });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: otherUsersThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });

  test("throws (login redirect) before writing when there is no session", async () => {
    // getCurrentUserId throws a Next.js redirect when unauthenticated;
    // simulate that and pin that no write happens first.
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      setEmailThreadFollowUp(emailThreadId, "2026-06-12")
    ).rejects.toThrow("NEXT_REDIRECT");

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: emailThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });
});

describe("setMessengerThreadFollowUp", () => {
  test("any signed-in user can set + clear on the firm-shared line", async () => {
    // The messenger inbox is firm-wide, so a user with no personal
    // claim on the line (it has userId null) can still snooze.
    const set = await setMessengerThreadFollowUp(
      messengerThreadId,
      "2026-06-12"
    );
    expect(set).toEqual({ ok: true });

    let thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: messengerThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toEqual(new Date(2026, 5, 12, 23, 59, 59, 999));

    const clear = await setMessengerThreadFollowUp(messengerThreadId, null);
    expect(clear).toEqual({ ok: true });

    thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: messengerThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });

  test("throws (login redirect) before writing when there is no session", async () => {
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      setMessengerThreadFollowUp(messengerThreadId, "2026-06-12")
    ).rejects.toThrow("NEXT_REDIRECT");

    const thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: messengerThreadId },
      select: { followUpAt: true },
    });
    expect(thread.followUpAt).toBeNull();
  });

  test("unknown thread id reads as not found", async () => {
    const result = await setMessengerThreadFollowUp(
      "nonexistent-thread-id",
      "2026-06-12"
    );
    expect(result).toEqual({ ok: false, error: "Thread not found" });
  });
});
