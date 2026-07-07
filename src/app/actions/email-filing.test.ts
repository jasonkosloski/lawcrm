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
      lastMessageAt: new Date("2026-06-10T14:30"),
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
