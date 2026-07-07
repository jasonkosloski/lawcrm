/**
 * Integration tests for the conversion actions (note → task,
 * task → deadline).
 *
 * Covers:
 *   - RBAC: each conversion gates on the *target* entity's create
 *     permission (tasks.create / deadlines.create), matching the
 *     direct capture path — conversions must not be a permission
 *     bypass.
 *   - happy path: created row carries the back-link (noteId /
 *     parentTaskId) and the source record stays intact.
 *   - missing-source guards + zod validation errors.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`. The mocked
 * `requirePermission` is a spy, so the gate tests assert the
 * permission key each action was wired to.
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
  convertNoteToTask,
  convertTaskToDeadline,
} from "@/app/actions/conversions";
import { inboxActionInitialState } from "@/lib/inbox-action-form";
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

const seedNote = async () => {
  const n = await prisma.note.create({
    data: {
      matterId,
      authorId: userId,
      content: "Call opposing counsel about discovery",
    },
    select: { id: true },
  });
  return n.id;
};

const seedTask = async () => {
  const t = await prisma.task.create({
    data: {
      matterId,
      title: "File CGIA notice",
      ownerId: userId,
    },
    select: { id: true },
  });
  return t.id;
};

const noteToTaskForm = () => {
  const fd = new FormData();
  fd.set("title", "Call opposing counsel");
  fd.set("description", "About the discovery dispute");
  fd.set("priority", "normal");
  return fd;
};

const taskToDeadlineForm = () => {
  const fd = new FormData();
  fd.set("title", "CGIA notice due");
  fd.set("dueDate", "2026-09-01");
  fd.set("kind", "manual");
  return fd;
};

// ── RBAC gates ──────────────────────────────────────────────────────────
//
// Conversions create the target entity, so they must enforce the same
// create permission as the direct capture path (captures.ts). These
// pin the exact key each action gates on.

describe("conversion action gates", () => {
  test("convertNoteToTask gates on tasks.create", async () => {
    const noteId = await seedNote();
    await convertNoteToTask(noteId, inboxActionInitialState, noteToTaskForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
  });

  test("convertTaskToDeadline gates on deadlines.create", async () => {
    const taskId = await seedTask();
    await convertTaskToDeadline(
      taskId,
      inboxActionInitialState,
      taskToDeadlineForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.create");
  });

  test("gate runs before any validation or DB read", async () => {
    // Even a garbage call (missing note, empty form) must hit the
    // gate — the permission check is the first thing in the action.
    await convertNoteToTask("missing", inboxActionInitialState, new FormData());
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
  });
});

// ── Note → Task ─────────────────────────────────────────────────────────

describe("convertNoteToTask", () => {
  test("creates a task back-linked to the note; note stays intact", async () => {
    const noteId = await seedNote();
    const res = await convertNoteToTask(
      noteId,
      inboxActionInitialState,
      noteToTaskForm()
    );
    expect(res.status).toBe("ok");

    const task = await prisma.task.findFirst({ where: { noteId } });
    expect(task).not.toBeNull();
    expect(task!.title).toBe("Call opposing counsel");
    expect(task!.matterId).toBe(matterId);
    expect(task!.ownerId).toBe(userId);

    const note = await prisma.note.findUnique({ where: { id: noteId } });
    expect(note).not.toBeNull();
  });

  test("rejects when the note no longer exists", async () => {
    const res = await convertNoteToTask(
      "missing",
      inboxActionInitialState,
      noteToTaskForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/no longer exists/i);
  });

  test("rejects an empty title", async () => {
    const noteId = await seedNote();
    const fd = noteToTaskForm();
    fd.set("title", "   ");
    const res = await convertNoteToTask(noteId, inboxActionInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.title?.length).toBeGreaterThan(0);
  });
});

// ── Task → Deadline ─────────────────────────────────────────────────────

describe("convertTaskToDeadline", () => {
  test("creates a deadline back-linked to the task; task stays intact", async () => {
    const taskId = await seedTask();
    const res = await convertTaskToDeadline(
      taskId,
      inboxActionInitialState,
      taskToDeadlineForm()
    );
    expect(res.status).toBe("ok");

    const deadline = await prisma.deadline.findFirst({
      where: { parentTaskId: taskId },
    });
    expect(deadline).not.toBeNull();
    expect(deadline!.title).toBe("CGIA notice due");
    expect(deadline!.matterId).toBe(matterId);
    // Owner carries over from the source task, not the converter.
    expect(deadline!.ownerId).toBe(userId);

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task).not.toBeNull();
  });

  test("rejects when the task no longer exists", async () => {
    const res = await convertTaskToDeadline(
      "missing",
      inboxActionInitialState,
      taskToDeadlineForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/no longer exists/i);
  });

  test("rejects a missing due date (deadlines require one)", async () => {
    const taskId = await seedTask();
    const fd = taskToDeadlineForm();
    fd.set("dueDate", "");
    const res = await convertTaskToDeadline(taskId, inboxActionInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.length).toBeGreaterThan(0);
  });
});
