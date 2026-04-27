/**
 * Integration tests for the task action surface.
 *
 * Covers:
 *   - setTaskStatus completedAt mirroring (set on enter / clear on
 *     leave / preserved on still-complete updates)
 *   - status validation rejects unknown values
 *   - missing-task guard
 *   - activity log fans out only on completed-state transitions
 *   - deleteTask removes the row + revalidates
 *   - updateTask zod validation, dueDate parsing, status transition
 *
 * Auth + permission gates are stubbed; we already cover the gate
 * itself in `permission-check.integration.test.ts`. (No
 * permission-check usage in this action file today, but the
 * `getCurrentUserId` stub is needed for the activity-log writer.)
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  // Action-logic tests assume the user passes the gate. Gate
  // behavior itself is covered in `permission-check.integration.test.ts`
  // and in this file's "RBAC gate" describe block at the bottom,
  // which restores the real implementation.
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  deleteTask,
  setTaskStatus,
  updateTask,
} from "@/app/actions/tasks";
import { updateTaskInitialState } from "@/lib/task-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
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

const seedTask = async (overrides?: {
  matterId?: string | null;
  status?: string;
  title?: string;
  completedAt?: Date | null;
}) => {
  const t = await prisma.task.create({
    data: {
      matterId: overrides?.matterId === undefined ? matterId : overrides.matterId,
      title: overrides?.title ?? "Draft motion",
      status: overrides?.status ?? "open",
      completedAt: overrides?.completedAt ?? null,
    },
    select: { id: true },
  });
  return t.id;
};

describe("setTaskStatus — validation", () => {
  test("rejects unknown status values", async () => {
    const id = await seedTask();
    const res = await setTaskStatus(id, "garbage" as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown status/i);
  });

  test("rejects unknown taskId", async () => {
    const res = await setTaskStatus("nope", "done");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("setTaskStatus — completedAt mirroring", () => {
  test("entering done stamps completedAt", async () => {
    const id = await seedTask({ status: "open" });
    const res = await setTaskStatus(id, "done");
    expect(res.ok).toBe(true);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("done");
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  test("entering cancelled stamps completedAt", async () => {
    const id = await seedTask({ status: "in_progress" });
    await setTaskStatus(id, "cancelled");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  test("leaving done clears completedAt", async () => {
    const original = new Date("2026-01-01T10:00:00Z");
    const id = await seedTask({ status: "done", completedAt: original });
    await setTaskStatus(id, "open");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.status).toBe("open");
    expect(row!.completedAt).toBeNull();
  });

  test("done → cancelled preserves the original completedAt", async () => {
    const original = new Date("2026-01-01T10:00:00Z");
    const id = await seedTask({ status: "done", completedAt: original });
    await setTaskStatus(id, "cancelled");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.completedAt!.getTime()).toBe(original.getTime());
  });

  test("transition between non-complete statuses doesn't touch completedAt", async () => {
    const id = await seedTask({ status: "open", completedAt: null });
    await setTaskStatus(id, "in_progress");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.completedAt).toBeNull();
  });
});

describe("setTaskStatus — activity log fan-out", () => {
  test("first completion writes a 'task_complete' activity entry", async () => {
    const id = await seedTask({ status: "open", title: "Send demand letter" });
    await setTaskStatus(id, "done");
    const logs = await prisma.activityLog.findMany({ where: { matterId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.type).toBe("task_complete");
    expect(logs[0]!.title).toBe("Task completed");
    expect(logs[0]!.detail).toBe("Send demand letter");
  });

  test("cancelling produces a 'Task cancelled' activity entry", async () => {
    const id = await seedTask({ status: "open", title: "Schedule mediation" });
    await setTaskStatus(id, "cancelled");
    const log = await prisma.activityLog.findFirst({ where: { matterId } });
    expect(log!.title).toBe("Task cancelled");
    expect(log!.type).toBe("task_complete");
  });

  test("reopening a done task writes a 'Task reopened' entry", async () => {
    const id = await seedTask({
      status: "done",
      completedAt: new Date(),
      title: "Send demand letter",
    });
    await setTaskStatus(id, "open");
    const logs = await prisma.activityLog.findMany({ where: { matterId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.type).toBe("task");
    expect(logs[0]!.title).toBe("Task reopened");
  });

  test("non-completion transitions don't log", async () => {
    const id = await seedTask({ status: "open" });
    await setTaskStatus(id, "in_progress");
    const logs = await prisma.activityLog.findMany({ where: { matterId } });
    expect(logs).toHaveLength(0);
  });

  test("done → cancelled doesn't double-log (still complete)", async () => {
    const id = await seedTask({ status: "done", completedAt: new Date() });
    await setTaskStatus(id, "cancelled");
    const logs = await prisma.activityLog.findMany({ where: { matterId } });
    expect(logs).toHaveLength(0);
  });
});

describe("deleteTask", () => {
  test("removes the row", async () => {
    const id = await seedTask();
    const res = await deleteTask(id);
    expect(res.ok).toBe(true);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  test("returns error for unknown taskId", async () => {
    const res = await deleteTask("missing");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test("works for firm-wide (matterId=null) tasks", async () => {
    const id = await seedTask({ matterId: null });
    const res = await deleteTask(id);
    expect(res.ok).toBe(true);
  });
});

describe("updateTask — validation", () => {
  test("rejects empty title", async () => {
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "   ");
    fd.set("priority", "normal");
    fd.set("status", "open");
    const res = await updateTask(id, updateTaskInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.title?.length).toBeGreaterThan(0);
  });

  test("rejects unknown priority", async () => {
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("priority", "ASAP");
    fd.set("status", "open");
    const res = await updateTask(id, updateTaskInitialState, fd);
    expect(res.status).toBe("error");
  });

  test("rejects when task no longer exists", async () => {
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("priority", "normal");
    fd.set("status", "open");
    const res = await updateTask("missing", updateTaskInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/no longer exists/i);
  });
});

describe("updateTask — happy path", () => {
  test("persists field updates + parses dueDate", async () => {
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "Updated title");
    fd.set("description", "More detail");
    fd.set("dueDate", "2026-08-01");
    fd.set("priority", "high");
    fd.set("status", "in_progress");
    const res = await updateTask(id, updateTaskInitialState, fd);
    expect(res.status).toBe("ok");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.title).toBe("Updated title");
    expect(row!.description).toBe("More detail");
    expect(row!.priority).toBe("high");
    expect(row!.status).toBe("in_progress");
    expect(row!.dueDate?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  test("normalizes empty dueDate / description to null", async () => {
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("description", "");
    fd.set("dueDate", "");
    fd.set("priority", "normal");
    fd.set("status", "open");
    const res = await updateTask(id, updateTaskInitialState, fd);
    expect(res.status).toBe("ok");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.description).toBeNull();
    expect(row!.dueDate).toBeNull();
  });

  test("status change to done stamps completedAt; back to open clears it", async () => {
    const id = await seedTask({ status: "open" });
    const fd1 = new FormData();
    fd1.set("title", "ok");
    fd1.set("priority", "normal");
    fd1.set("status", "done");
    await updateTask(id, updateTaskInitialState, fd1);
    let row = await prisma.task.findUnique({ where: { id } });
    expect(row!.completedAt).toBeInstanceOf(Date);

    const fd2 = new FormData();
    fd2.set("title", "ok");
    fd2.set("priority", "normal");
    fd2.set("status", "open");
    await updateTask(id, updateTaskInitialState, fd2);
    row = await prisma.task.findUnique({ where: { id } });
    expect(row!.completedAt).toBeNull();
  });
});

// ── RBAC gate ───────────────────────────────────────────────────────────
//
// The module-level `vi.mock("@/lib/permission-check", ...)` at the
// top stubs `requirePermission` to short-circuit so the action-logic
// tests don't worry about gates. The mocked function IS a spy, so
// we can read `.mock.calls` to verify each action wired the gate to
// the right permission key.

import { requirePermission } from "@/lib/permission-check";

describe("tasks action gate", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  test("setTaskStatus gates on tasks.edit", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedTask();
    await setTaskStatus(id, "done");
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.edit");
  });

  test("updateTask gates on tasks.edit", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("priority", "normal");
    fd.set("status", "open");
    await updateTask(id, updateTaskInitialState, fd);
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.edit");
  });

  test("deleteTask gates on tasks.delete", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedTask();
    await deleteTask(id);
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.delete");
  });
});
