/**
 * Integration tests for the email thread star/archive actions.
 *
 * Pins the v1.1 flag contract:
 *   - local flip commits first and is mailbox-scoped (another user's
 *     thread refuses without writing);
 *   - the Gmail writeback payload per transition (STARRED add/remove,
 *     INBOX remove on archive / add on unarchive) — `gmail-writeback`
 *     is mocked here; its own suite covers the never-rejects contract;
 *   - threads without an externalId flip locally with NO writeback;
 *   - archive's no-op discipline (same state → no write / writeback /
 *     revalidation).
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
  setEmailThreadArchived,
  toggleEmailThreadStar,
} from "@/app/actions/email-thread-flags";
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
let matterId: string;
let accountId: string;
let threadId: string; // mine, externalId "gt-1", filed to matterId
let localOnlyThreadId: string; // mine, NO externalId
let otherUsersThreadId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const other = await seedUser({ firmId, email: "other@example.com" });
  mockedGetUser.mockResolvedValue(userId);

  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));

  const [mine, theirs] = await Promise.all([
    prisma.emailAccount.create({
      data: { userId, emailAddress: "me@example.com", refreshToken: "rt" },
      select: { id: true },
    }),
    prisma.emailAccount.create({
      data: { userId: other.userId, emailAddress: "them@example.com" },
      select: { id: true },
    }),
  ]);
  accountId = mine.id;
  const lastMessageAt = new Date("2026-06-01T10:00:00Z");
  const [t1, t2, t3] = await Promise.all([
    prisma.emailThread.create({
      data: {
        accountId: mine.id,
        externalId: "gt-1",
        matterId,
        subject: "Re: discovery deadline",
        lastMessageAt,
      },
      select: { id: true },
    }),
    prisma.emailThread.create({
      data: {
        accountId: mine.id,
        subject: "Local-only (no externalId)",
        lastMessageAt,
      },
      select: { id: true },
    }),
    prisma.emailThread.create({
      data: {
        accountId: theirs.id,
        externalId: "gt-theirs",
        subject: "Someone else's mail",
        lastMessageAt,
      },
      select: { id: true },
    }),
  ]);
  threadId = t1.id;
  localOnlyThreadId = t2.id;
  otherUsersThreadId = t3.id;
});

describe("toggleEmailThreadStar", () => {
  test("stars locally and writes back `add STARRED`", async () => {
    const res = await toggleEmailThreadStar(threadId);
    expect(res).toEqual({ ok: true, isStarred: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { isStarred: true },
    });
    expect(thread.isStarred).toBe(true);
    expect(mockedWriteback).toHaveBeenCalledWith(accountId, "gt-1", {
      addLabelIds: ["STARRED"],
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
    expect(mockedRevalidate).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });

  test("toggling again unstars and writes back `remove STARRED`", async () => {
    await toggleEmailThreadStar(threadId);
    mockedWriteback.mockClear();

    const res = await toggleEmailThreadStar(threadId);
    expect(res).toEqual({ ok: true, isStarred: false });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { isStarred: true },
    });
    expect(thread.isStarred).toBe(false);
    expect(mockedWriteback).toHaveBeenCalledWith(accountId, "gt-1", {
      removeLabelIds: ["STARRED"],
    });
  });

  test("thread without an externalId flips locally with NO writeback", async () => {
    const res = await toggleEmailThreadStar(localOnlyThreadId);
    expect(res).toEqual({ ok: true, isStarred: true });
    expect(mockedWriteback).not.toHaveBeenCalled();
  });

  test("cannot star a thread in another user's mailbox", async () => {
    const res = await toggleEmailThreadStar(otherUsersThreadId);
    expect(res).toEqual({ ok: false });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: otherUsersThreadId },
      select: { isStarred: true },
    });
    expect(thread.isStarred).toBe(false);
    expect(mockedWriteback).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  test("throws (login redirect) before writing when there is no session", async () => {
    mockedGetUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(toggleEmailThreadStar(threadId)).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { isStarred: true },
    });
    expect(thread.isStarred).toBe(false);
  });
});

describe("setEmailThreadArchived", () => {
  test("archives locally and writes back `remove INBOX`", async () => {
    const res = await setEmailThreadArchived(threadId, true);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { isArchived: true },
    });
    expect(thread.isArchived).toBe(true);
    expect(mockedWriteback).toHaveBeenCalledWith(accountId, "gt-1", {
      removeLabelIds: ["INBOX"],
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
  });

  test("unarchive restores INBOX", async () => {
    await setEmailThreadArchived(threadId, true);
    mockedWriteback.mockClear();

    const res = await setEmailThreadArchived(threadId, false);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { isArchived: true },
    });
    expect(thread.isArchived).toBe(false);
    expect(mockedWriteback).toHaveBeenCalledWith(accountId, "gt-1", {
      addLabelIds: ["INBOX"],
    });
  });

  test("no-ops (no write / writeback / revalidation) when already in the requested state", async () => {
    const res = await setEmailThreadArchived(threadId, false);
    expect(res).toEqual({ ok: true });
    expect(mockedWriteback).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  test("thread without an externalId archives locally with NO writeback", async () => {
    const res = await setEmailThreadArchived(localOnlyThreadId, true);
    expect(res).toEqual({ ok: true });
    expect(mockedWriteback).not.toHaveBeenCalled();

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: localOnlyThreadId },
      select: { isArchived: true },
    });
    expect(thread.isArchived).toBe(true);
  });

  test("cannot archive a thread in another user's mailbox", async () => {
    const res = await setEmailThreadArchived(otherUsersThreadId, true);
    expect(res).toEqual({ ok: false });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: otherUsersThreadId },
      select: { isArchived: true },
    });
    expect(thread.isArchived).toBe(false);
    expect(mockedWriteback).not.toHaveBeenCalled();
  });
});
