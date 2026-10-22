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
 *   - updateTask owner tri-state (absent = untouched, "" = clear,
 *     id = assign) + the assignment notification on real changes
 *   - setTaskOwner reassignment + the "task_assigned" notification
 *     (fires for the new owner, skipped on self-assign / no-op)
 *
 * Auth + permission gates are stubbed; we already cover the gate
 * itself in `permission-check.integration.test.ts`. The gate keys
 * each action demands are asserted in the "tasks action gate" block
 * at the bottom (the stub is a spy), and the `getCurrentUserId` stub
 * supplies the actor for the activity-log writer.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  // Action-logic tests assume the user passes the gate. Gate
  // behavior itself is covered in `permission-check.integration.test.ts`;
  // this file's "tasks action gate" block at the bottom only asserts
  // which key each action demands (the stub is a spy).
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteTask, setTaskOwner, setTaskStatus, updateTask } from "@/app/actions/tasks";
import { updateTaskInitialState } from "@/lib/task-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
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
  ownerId?: string | null;
}) => {
  const t = await prisma.task.create({
    data: {
      matterId: overrides?.matterId === undefined ? matterId : overrides.matterId,
      title: overrides?.title ?? "Draft motion",
      status: overrides?.status ?? "open",
      completedAt: overrides?.completedAt ?? null,
      ownerId: overrides?.ownerId ?? null,
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

describe("setTaskOwner — assignment + notification", () => {
  test("assigns the owner and notifies them with a task_assigned row", async () => {
    const assignee = await seedUser({ firmId, email: "assignee@example.com" });
    const id = await seedTask({ title: "Depose Officer Reyes" });

    const res = await setTaskOwner(id, assignee.userId);
    expect(res.ok).toBe(true);

    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBe(assignee.userId);

    const notes = await prisma.notification.findMany({
      where: { userId: assignee.userId },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("task_assigned");
    expect(notes[0]!.title).toContain("Depose Officer Reyes");
    expect(notes[0]!.link).toBe(`/matters/${matterId}/tasks`);
    expect(notes[0]!.matterId).toBe(matterId);
  });

  test("self-assignment does NOT notify (actor exclusion)", async () => {
    const id = await seedTask();
    const res = await setTaskOwner(id, userId); // actor is `userId`
    expect(res.ok).toBe(true);

    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBe(userId);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("no-op reassignment to the same owner doesn't re-notify", async () => {
    const assignee = await seedUser({ firmId, email: "again@example.com" });
    const id = await seedTask({ ownerId: assignee.userId });

    const res = await setTaskOwner(id, assignee.userId);
    expect(res.ok).toBe(true);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("clearing the owner works and never notifies", async () => {
    const assignee = await seedUser({ firmId, email: "cleared@example.com" });
    const id = await seedTask({ ownerId: assignee.userId });

    const res = await setTaskOwner(id, null);
    expect(res.ok).toBe(true);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  test("firm-wide task (matterId=null) notifies with a dashboard link", async () => {
    const assignee = await seedUser({ firmId, email: "firmwide@example.com" });
    const id = await seedTask({ matterId: null });

    await setTaskOwner(id, assignee.userId);
    const note = await prisma.notification.findFirst({
      where: { userId: assignee.userId },
    });
    expect(note!.link).toBe("/");
    expect(note!.matterId).toBeNull();
    expect(note!.body).toMatch(/firm-wide/i);
  });

  test("rejects unknown task / unknown or inactive assignee", async () => {
    expect((await setTaskOwner("missing", userId)).ok).toBe(false);

    const id = await seedTask();
    expect((await setTaskOwner(id, "no-such-user")).ok).toBe(false);

    const inactive = await seedUser({
      firmId,
      email: "inactive@example.com",
      isActive: false,
    });
    const res = await setTaskOwner(id, inactive.userId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/inactive|not found/i);
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
    // Date-only (ADR-012): the calendar date is stored as UTC midnight.
    expect(row!.dueDate!.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("dueDate is stored as UTC midnight in any server zone (regression)", async () => {
    // ADR-012: a date-only value is a calendar date at UTC midnight,
    // read back in UTC by every consumer. Local-midnight storage
    // (the old server-local-midnight frame) lands on 06:00/07:00Z on a Denver
    // machine, which this exact-instant assertion catches there.
    const id = await seedTask();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-08-01");
    fd.set("priority", "normal");
    fd.set("status", "open");
    await updateTask(id, updateTaskInitialState, fd);
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.dueDate!.getTime()).toBe(Date.UTC(2026, 7, 1));
  });

  test("malformed dueDate is a field error and leaves the existing date alone", async () => {
    const id = await prisma.task
      .create({
        data: {
          matterId,
          title: "Keep my date",
          dueDate: new Date(Date.UTC(2026, 9, 16)),
        },
        select: { id: true },
      })
      .then((t) => t.id);
    for (const bad of ["08/01/2026", "2026-02-31", "2026-13-40"]) {
      const fd = new FormData();
      fd.set("title", "ok");
      fd.set("dueDate", bad);
      fd.set("priority", "normal");
      fd.set("status", "open");
      const res = await updateTask(id, updateTaskInitialState, fd);
      expect(res.status).toBe("error");
      expect(res.errors?.dueDate?.[0]).toMatch(/invalid due date/i);
    }
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.dueDate!.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(row!.title).toBe("Keep my date");
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

describe("updateTask — owner tri-state + notification", () => {
  /** Valid base form; tests set/omit ownerId. */
  const taskForm = (overrides: Record<string, string> = {}): FormData => {
    const fd = new FormData();
    fd.set("title", "Draft motion");
    fd.set("priority", "normal");
    fd.set("status", "open");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  };

  test("assigning another user sets the owner and notifies them", async () => {
    const assignee = await seedUser({ firmId, email: "edit-assign@example.com" });
    const id = await seedTask();

    const res = await updateTask(
      id,
      updateTaskInitialState,
      taskForm({ ownerId: assignee.userId }),
    );
    expect(res.status).toBe("ok");

    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBe(assignee.userId);

    const notes = await prisma.notification.findMany({
      where: { userId: assignee.userId },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("task_assigned");
    expect(notes[0]!.link).toBe(`/matters/${matterId}/tasks`);
  });

  test("absent ownerId field leaves the owner untouched", async () => {
    const assignee = await seedUser({ firmId, email: "keep@example.com" });
    const id = await seedTask({ ownerId: assignee.userId });

    const res = await updateTask(id, updateTaskInitialState, taskForm());
    expect(res.status).toBe("ok");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBe(assignee.userId);
    expect(await prisma.notification.count()).toBe(0);
  });

  test('ownerId="" clears the owner and never notifies', async () => {
    const assignee = await seedUser({ firmId, email: "clear-edit@example.com" });
    const id = await seedTask({ ownerId: assignee.userId });

    const res = await updateTask(id, updateTaskInitialState, taskForm({ ownerId: "" }));
    expect(res.status).toBe("ok");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  test("unchanged owner doesn't re-notify (no-op save)", async () => {
    const assignee = await seedUser({ firmId, email: "noop-edit@example.com" });
    const id = await seedTask({ ownerId: assignee.userId });

    const res = await updateTask(
      id,
      updateTaskInitialState,
      taskForm({ ownerId: assignee.userId }),
    );
    expect(res.status).toBe("ok");
    expect(await prisma.notification.count()).toBe(0);
  });

  test("self-assignment saves but is notification-silent (actor exclusion)", async () => {
    const id = await seedTask();
    const res = await updateTask(id, updateTaskInitialState, taskForm({ ownerId: userId }));
    expect(res.status).toBe("ok");
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.ownerId).toBe(userId);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("inactive assignee comes back as an ownerId field error, nothing written", async () => {
    const inactive = await seedUser({
      firmId,
      email: "edit-inactive@example.com",
      isActive: false,
    });
    const id = await seedTask({ title: "Original title" });

    const res = await updateTask(
      id,
      updateTaskInitialState,
      taskForm({ title: "Changed title", ownerId: inactive.userId }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.ownerId?.[0]).toMatch(/inactive|not found/i);

    // The whole update is rejected — not just the owner column.
    const row = await prisma.task.findUnique({ where: { id } });
    expect(row!.title).toBe("Original title");
    expect(row!.ownerId).toBeNull();
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

  test("setTaskOwner gates on tasks.edit", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedTask();
    await setTaskOwner(id, null);
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.edit");
  });
});

// ── Audit trail + stale-form guard ─────────────────────────────────────

describe("task audit trail (F189)", () => {
  const logs = () =>
    prisma.activityLog.findMany({
      where: { matterId, type: { in: ["task", "task_complete"] } },
      orderBy: { timestamp: "asc" },
      select: { title: true, detail: true, userId: true },
    });

  test("an edit logs only what changed, old -> new", async () => {
    const id = await prisma.task
      .create({
        data: {
          matterId,
          title: "Draft motion",
          dueDate: new Date(Date.UTC(2026, 10, 3)),
          priority: "normal",
        },
        select: { id: true },
      })
      .then((t) => t.id);
    const fd = new FormData();
    fd.set("title", "Draft motion");
    fd.set("dueDate", "2026-12-15");
    fd.set("priority", "high");
    fd.set("status", "open");
    await updateTask(id, updateTaskInitialState, fd);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Task updated");
    expect(rows[0].detail).toContain("due 2026-11-03 → 2026-12-15");
    expect(rows[0].detail).toContain("priority normal → high");
    expect(rows[0].detail).not.toContain("title");
    expect(rows[0].userId).toBe(userId);
  });

  test("an edit that changes nothing writes no row", async () => {
    const id = await seedTask({ title: "Same" });
    const fd = new FormData();
    fd.set("title", "Same");
    fd.set("priority", "normal");
    fd.set("status", "open");
    await updateTask(id, updateTaskInitialState, fd);
    expect(await logs()).toHaveLength(0);
  });

  test("completing through the dialog logs a completion", async () => {
    const id = await seedTask({ title: "File it" });
    const fd = new FormData();
    fd.set("title", "File it");
    fd.set("priority", "normal");
    fd.set("status", "done");
    await updateTask(id, updateTaskInitialState, fd);
    const rows = await logs();
    expect(rows.map((r) => r.title)).toEqual(["Task completed"]);
  });

  test("deleting logs the title captured before the row went away", async () => {
    const id = await seedTask({ title: "Serve the subpoena" });
    await deleteTask(id);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Task deleted");
    expect(rows[0].detail).toContain("Serve the subpoena");
  });
});

describe("updateTask - stale form guard (F521)", () => {
  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("title", "Edited by A");
    fd.set("priority", "normal");
    fd.set("status", "open");
    for (const [k, v] of Object.entries(over)) fd.set(k, v);
    return fd;
  };

  test("a form seeded before someone else's save is refused and writes nothing", async () => {
    const id = await seedTask({ title: "Original" });
    const seeded = await prisma.task.findUniqueOrThrow({ where: { id } });
    // Someone else saves in between.
    await prisma.task.update({
      where: { id },
      data: { title: "Edited by B" },
    });

    const res = await updateTask(
      id,
      updateTaskInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/changed by someone else/i);
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe("Edited by B");
  });

  test("a stale refusal revalidates the matter's task surfaces so the reopened dialog gets fresh props", async () => {
    const id = await seedTask({ title: "Original" });
    const seeded = await prisma.task.findUniqueOrThrow({ where: { id } });
    await prisma.task.update({
      where: { id },
      // Explicit bump: seed and update can land in the same ms.
      data: { title: "Edited by B", updatedAt: new Date(seeded.updatedAt.getTime() + 1000) },
    });
    vi.mocked(revalidatePath).mockClear();

    const res = await updateTask(
      id,
      updateTaskInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("error");
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/tasks`);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  test("a form seeded from the current row saves", async () => {
    const id = await seedTask({ title: "Original" });
    const seeded = await prisma.task.findUniqueOrThrow({ where: { id } });
    const res = await updateTask(
      id,
      updateTaskInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("ok");
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).title).toBe("Edited by A");
  });

  test("no expectedUpdatedAt field = no check (legacy callers)", async () => {
    const id = await seedTask({ title: "Original" });
    const res = await updateTask(id, updateTaskInitialState, form());
    expect(res.status).toBe("ok");
  });
});

describe("records follow-up task hook", () => {
  test("updateTask moving a follow-up task to done rolls the request", async () => {
    const contact = await prisma.contact.create({
      data: { name: "Mercy Hospital", type: "person" } as never,
    });
    const req = await prisma.recordsRequest.create({
      data: {
        matterId,
        custodianContactId: contact.id,
        adHocTypeName: "Chart",
        subject: "Chart",
        status: "sent",
        ownerId: userId,
        nextFollowUpDate: new Date("2026-10-25T00:00:00Z"),
      },
    });
    const task = await prisma.task.create({
      data: { matterId, title: "Follow up", recordsRequestId: req.id },
    });
    const fd = new FormData();
    fd.set("title", "Follow up");
    fd.set("status", "done");
    const res = await updateTask(task.id, updateTaskInitialState, fd);
    expect(res.status).toBe("ok");
    expect(await prisma.recordsRequestFollowUp.count()).toBe(1);
    expect(
      await prisma.task.count({
        where: { recordsRequestId: req.id, status: "open" },
      }),
    ).toBe(1);
  });
});
