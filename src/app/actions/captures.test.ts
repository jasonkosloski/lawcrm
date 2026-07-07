/**
 * Integration tests for `createTaskWithCaptures` — the TASK path of
 * the capture actions only (event/deadline/time primaries have their
 * own coverage via the composer + conversion suites).
 *
 * Focus: the create-time assignee picker semantics.
 *   - ownerId ABSENT → self-assign (pre-picker behavior preserved)
 *   - ownerId = user id → assigned + "task_assigned" notification
 *     (same helper as setTaskOwner, actor-exclusion applies)
 *   - ownerId = "" → created unassigned, no notification
 *   - inactive assignee → ownerId field error, NO task created
 *   - gate: requirePermission("tasks.create")
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
import { createTaskWithCaptures } from "@/app/actions/captures";
import { captureInitialState } from "@/lib/capture-schemas";
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

/** Minimal valid task form; tests set/omit ownerId. */
const taskForm = (overrides: Record<string, string> = {}): FormData => {
  const fd = new FormData();
  fd.set("title", "Serve the subpoena");
  fd.set("priority", "normal");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
};

describe("createTaskWithCaptures — assignee tri-state", () => {
  test("absent ownerId self-assigns (legacy behavior) with no notification", async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm()
    );
    expect(res.status).toBe("ok");

    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    expect(task.ownerId).toBe(userId);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("assigning another user notifies them on create", async () => {
    const assignee = await seedUser({ firmId, email: "create-assign@example.com" });

    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ ownerId: assignee.userId })
    );
    expect(res.status).toBe("ok");

    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    expect(task.ownerId).toBe(assignee.userId);

    const notes = await prisma.notification.findMany({
      where: { userId: assignee.userId },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("task_assigned");
    expect(notes[0]!.title).toContain("Serve the subpoena");
    expect(notes[0]!.link).toBe(`/matters/${matterId}/tasks`);
    expect(notes[0]!.matterId).toBe(matterId);
  });

  test("explicit self-assignment is notification-silent (actor exclusion)", async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ ownerId: userId })
    );
    expect(res.status).toBe("ok");
    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    expect(task.ownerId).toBe(userId);
    expect(await prisma.notification.count()).toBe(0);
  });

  test('ownerId="" creates the task unassigned, no notification', async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ ownerId: "" })
    );
    expect(res.status).toBe("ok");
    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    expect(task.ownerId).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  test("inactive assignee returns an ownerId field error and creates nothing", async () => {
    const inactive = await seedUser({
      firmId,
      email: "create-inactive@example.com",
      isActive: false,
    });

    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ ownerId: inactive.userId })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.ownerId?.[0]).toMatch(/inactive|not found/i);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("unknown assignee id is rejected the same way", async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ ownerId: "no-such-user" })
    );
    expect(res.status).toBe("error");
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("createTaskWithCaptures — gate", () => {
  test("gates on tasks.create", async () => {
    vi.mocked(requirePermission).mockClear();
    await createTaskWithCaptures(matterId, captureInitialState, taskForm());
    expect(requirePermission).toHaveBeenCalledWith("tasks.create");
  });
});
