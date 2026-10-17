/**
 * Integration tests for the email file-to-matter action.
 *
 * Covers:
 *   - permission gate: setEmailThreadMatter requires
 *     `communication.file_email` (the gate itself is covered by
 *     permission-check.integration.test.ts — here we pin that the
 *     action asks for the right key)
 *   - error paths: unknown thread, unknown matter
 *   - filing: FK set + "Email filed to matter" activity entry
 *   - unfiling: FK cleared + "Email removed from matter" activity
 *     entry against the matter the thread is leaving
 *   - unfiling an already-unfiled thread writes no activity entry
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Matter-wall asserts are covered in matter-access-writes.test.ts; this
// file exercises other behaviour with no authenticated session user.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
  assertOptionalMatterAccess: vi.fn(async () => "test-user"),
  assertChildMatterAccess: vi.fn(async () => null),
  canAccessMatter: vi.fn(async () => true),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { setEmailThreadMatter } from "@/app/actions/email-filing";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;

/** Thread under a bare gmail account. `matterId` = pre-filed state. */
async function seedThread(opts?: { matterId?: string }): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: { userId, emailAddress: "attorney@example.com" },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      matterId: opts?.matterId ?? null,
      subject: "RE: Discovery responses",
      lastMessageAt: new Date("2026-06-10T14:30:00Z"),
    },
    select: { id: true },
  });
  return thread.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

describe("permission gate", () => {
  test("asks for communication.file_email before touching the thread", async () => {
    const threadId = await seedThread();
    await setEmailThreadMatter(threadId, matterId);
    expect(requirePermission).toHaveBeenCalledWith(
      "communication.file_email"
    );
  });
});

describe("error paths", () => {
  test("unknown thread", async () => {
    const res = await setEmailThreadMatter("nope", matterId);
    expect(res).toEqual({ ok: false, error: "Thread not found" });
  });

  test("unknown matter leaves the thread untouched", async () => {
    const threadId = await seedThread();
    const res = await setEmailThreadMatter(threadId, "nope");
    expect(res).toEqual({ ok: false, error: "Matter not found" });
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBeNull();
    expect(await prisma.activityLog.count()).toBe(0);
  });
});

describe("filing", () => {
  test("sets the FK and logs to the matter timeline", async () => {
    const threadId = await seedThread();
    const res = await setEmailThreadMatter(threadId, matterId);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBe(matterId);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { type: "email" },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.userId).toBe(userId);
    expect(activity.title).toBe("Email filed to matter");
    expect(activity.detail).toBe("RE: Discovery responses");

    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });
});

describe("unfiling", () => {
  test("clears the FK and audits against the matter it left", async () => {
    const threadId = await seedThread({ matterId });
    const res = await setEmailThreadMatter(threadId, null);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBeNull();

    // Removal is as auditable as filing — entry lands on the matter
    // the thread just left.
    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { type: "email" },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.userId).toBe(userId);
    expect(activity.title).toBe("Email removed from matter");
    expect(activity.detail).toBe("RE: Discovery responses");

    // Moved-out matter's Communication tab refreshes too.
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });

  test("unfiling an already-unfiled thread logs nothing", async () => {
    const threadId = await seedThread();
    const res = await setEmailThreadMatter(threadId, null);
    expect(res).toEqual({ ok: true });
    expect(await prisma.activityLog.count()).toBe(0);
  });
});

describe("mailbox ownership", () => {
  /** A thread in ANOTHER user's mailbox, optionally pre-filed. */
  async function seedForeignThread(filedTo?: string): Promise<string> {
    const { firmId } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firmId: true },
    });
    const { userId: ownerId } = await seedUser({ firmId: firmId as string });
    const account = await prisma.emailAccount.create({
      data: { userId: ownerId, emailAddress: "owner@example.com" },
      select: { id: true },
    });
    const thread = await prisma.emailThread.create({
      data: {
        accountId: account.id,
        matterId: filedTo ?? null,
        subject: "Privileged: settlement authority",
        lastMessageAt: new Date("2026-06-10T14:30:00Z"),
      },
      select: { id: true },
    });
    return thread.id;
  }

  test("a non-owner cannot file a colleague's thread to a matter", async () => {
    const threadId = await seedForeignThread();
    const res = await setEmailThreadMatter(threadId, matterId);
    expect(res).toEqual({ ok: false, error: "Thread not found" });
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBeNull();
    // Nothing (least of all the subject) reaches a matter timeline.
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("a non-owner cannot unfile or move a colleague's filed thread", async () => {
    const threadId = await seedForeignThread(matterId);
    vi.mocked(revalidatePath).mockClear();

    expect(await setEmailThreadMatter(threadId, null)).toEqual({
      ok: false,
      error: "Thread not found",
    });
    expect(await setEmailThreadMatter(threadId, matterId)).toEqual({
      ok: false,
      error: "Thread not found",
    });
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBe(matterId);
    expect(await prisma.activityLog.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("moving and re-filing (F557 / F662)", () => {
  async function seedSecondMatter(): Promise<string> {
    const first = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: { practiceAreaId: true, stageId: true },
    });
    const m = await seedMatter({
      practiceAreaId: first.practiceAreaId,
      stageId: first.stageId,
      leadUserId: userId,
      name: "Second matter",
    });
    return m.matterId;
  }

  test("moving A -> B logs removal on A and filing on B", async () => {
    const otherMatterId = await seedSecondMatter();
    const threadId = await seedThread({ matterId });

    const res = await setEmailThreadMatter(threadId, otherMatterId);
    expect(res).toEqual({ ok: true });

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBe(otherMatterId);

    const onA = await prisma.activityLog.findMany({
      where: { matterId, type: "email" },
    });
    expect(onA.map((a) => a.title)).toEqual(["Email removed from matter"]);
    expect(onA[0].detail).toBe("RE: Discovery responses");
    const onB = await prisma.activityLog.findMany({
      where: { matterId: otherMatterId, type: "email" },
    });
    expect(onB.map((a) => a.title)).toEqual(["Email filed to matter"]);

    // Both sides' Communication tabs refresh.
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${otherMatterId}/communication`
    );
  });

  test("re-selecting the matter the thread is already on writes and logs nothing", async () => {
    const threadId = await seedThread({ matterId });
    vi.mocked(revalidatePath).mockClear();

    const res = await setEmailThreadMatter(threadId, matterId);

    expect(res).toEqual({ ok: true });
    expect(await prisma.activityLog.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
