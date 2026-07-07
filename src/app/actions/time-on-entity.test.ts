/**
 * Integration tests for the entity-scoped "log time on this X"
 * actions (task / deadline / email message / messenger item).
 *
 * Covers:
 *   - RBAC gate: all four actions hit `time_entries.create` — the
 *     same key as the sibling create paths in time-entries.ts and
 *     captures.ts — and the gate fires BEFORE any row is written,
 *     so a denied user can't log time through these side doors.
 *   - Happy path: gate passes → entry lands with the parent FK set.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  addTimeEntryToDeadline,
  addTimeEntryToEmailMessage,
  addTimeEntryToMessengerItem,
  addTimeEntryToTask,
} from "@/app/actions/time-on-entity";
import { noteAttachmentInitialState } from "@/lib/note-attachment-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "logger@example.com" });
  userId = u.userId;
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

const buildTimeForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("date", overrides.date ?? "2026-04-01");
  fd.set("hours", overrides.hours ?? "0.5");
  fd.set("activity", overrides.activity ?? "Reviewing");
  fd.set("narrative", overrides.narrative ?? "");
  return fd;
};

const seedTask = async () => {
  const t = await prisma.task.create({
    data: { matterId, title: "Draft motion", status: "open" },
    select: { id: true },
  });
  return t.id;
};

// ── RBAC gates ──────────────────────────────────────────────────────────

describe("time-on-entity action gates", () => {
  // Bogus parent ids are fine here: the gate must fire before the
  // parent lookup, so the permission call is observable either way.
  test("addTimeEntryToTask gates on time_entries.create", async () => {
    await addTimeEntryToTask("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToDeadline gates on time_entries.create", async () => {
    await addTimeEntryToDeadline("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToEmailMessage gates on time_entries.create", async () => {
    await addTimeEntryToEmailMessage("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToMessengerItem gates on time_entries.create", async () => {
    await addTimeEntryToMessengerItem("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("denied permission blocks the write entirely", async () => {
    const taskId = await seedTask();
    // requirePermission redirects (throws) on denial — simulate that.
    mockedRequirePermission.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      addTimeEntryToTask(taskId, noteAttachmentInitialState, buildTimeForm())
    ).rejects.toThrow();
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

// ── Happy path ──────────────────────────────────────────────────────────

describe("addTimeEntryToTask — creation", () => {
  test("creates the entry with the task FK when the gate passes", async () => {
    const taskId = await seedTask();
    const res = await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ hours: "1.5", activity: "Drafting" })
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirstOrThrow({
      select: { taskId: true, matterId: true, userId: true, source: true },
    });
    expect(entry.taskId).toBe(taskId);
    expect(entry.matterId).toBe(matterId);
    expect(entry.userId).toBe(userId);
    expect(entry.source).toBe("task");
  });
});
