/**
 * Integration tests for the primary-capture actions
 * (createTaskWithCaptures / createEventWithCaptures /
 * createDeadlineWithCaptures / createTimeEntryWithCaptures).
 *
 * Focus areas:
 *   - the create-time assignee picker semantics (task primary)
 *   - event times are wall-clock in the creator's zone (ADR-012),
 *     for primary and sibling events alike
 *   - date-only fields are stored at UTC midnight
 *   - sibling link-backs, sibling-note text fidelity, per-kind gates
 *   - a stale matter id is a form error, not an FK crash
 *
 * The task-assignee semantics:
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
// Server-only zone resolver: stubbed so tests can pick the creator's
// profile zone.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn().mockResolvedValue("UTC"),
}));
vi.mock("@/lib/permission-check", () => {
  const requirePermission = vi.fn().mockResolvedValue("test-user");
  return {
    requirePermission,
    // Multi-key gate: delegate per key so tests can deny one key via
    // the requirePermission mock (and assert which keys were demanded).
    requirePermissions: vi.fn(async (keys: Iterable<string>) => {
      for (const key of keys) await requirePermission(key);
      return "test-user";
    }),
    currentUserHasPermission: vi.fn().mockResolvedValue(true),
  };
});
// Sibling/primary events push to Google after commit; the push module
// is covered by its own suite, so stub it and assert the calls.
vi.mock("@/lib/google/google-calendar-push", () => ({
  pushEventToGoogle: vi.fn().mockResolvedValue(undefined),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  createDeadlineWithCaptures,
  createEventWithCaptures,
  createTaskWithCaptures,
  createTimeEntryWithCaptures,
} from "@/app/actions/captures";
import { captureInitialState } from "@/lib/capture-schemas";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedTz = vi.mocked(getCurrentUserTimeZone);

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
  mockedTz.mockResolvedValue("UTC");
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

// ── Event times: wall-clock in the creator's zone (ADR-012) ─────────────

const eventForm = (over: Record<string, string> = {}): FormData => {
  const fd = new FormData();
  fd.set("title", "Motion hearing");
  fd.set("type", "hearing");
  fd.set("startTime", "2026-10-16T09:00");
  fd.set("endTime", "2026-10-16T10:30");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
};

describe("createTaskWithCaptures — zone lookup", () => {
  test("a task with no event sibling never looks up the user's time zone", async () => {
    mockedTz.mockClear();
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm()
    );
    expect(res.status).toBe("ok");
    expect(mockedTz).not.toHaveBeenCalled();
  });
});

describe("createEventWithCaptures — instants", () => {
  test("a 9:00 AM Denver hearing is stored as 15:00Z (not 09:00Z)", async () => {
    mockedTz.mockResolvedValue("America/Denver");
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      eventForm()
    );
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
    });
    expect(ev.startTime.toISOString()).toBe("2026-10-16T15:00:00.000Z");
    expect(ev.endTime.toISOString()).toBe("2026-10-16T16:30:00.000Z");
    expect(ev.createdById).toBe(userId);
  });

  test("the same wall-clock value lands on a different instant for a user in another zone", async () => {
    mockedTz.mockResolvedValue("America/New_York");
    await createEventWithCaptures(matterId, captureInitialState, eventForm());
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
    });
    expect(ev.startTime.toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });

  test("sibling event on a task gets the creator's zone, a creator and an attendee", async () => {
    mockedTz.mockResolvedValue("America/Denver");
    const fd = taskForm({
      attachments: JSON.stringify([
        {
          kind: "event",
          tempId: "e1",
          title: "Client call",
          startTime: "2026-10-16T09:00",
          endTime: "2026-10-16T09:30",
          type: "meeting",
          location: "",
        },
      ]),
    });
    const res = await createTaskWithCaptures(matterId, captureInitialState, fd);
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    expect(ev.startTime.toISOString()).toBe("2026-10-16T15:00:00.000Z");
    expect(ev.createdById).toBe(userId);
    expect(ev.attendees.map((a) => a.userId)).toContain(userId);
  });

  test("an end before the start is a field error and creates nothing", async () => {
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      eventForm({ endTime: "2026-10-16T08:00" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.endTime?.[0]).toMatch(/after start/i);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });
});

// ── Deadline / time primaries + siblings ────────────────────────────────

const deadlineForm = (over: Record<string, string> = {}): FormData => {
  const fd = new FormData();
  fd.set("title", "Answer due");
  fd.set("dueDate", "2026-10-16");
  fd.set("kind", "critical");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
};

const timeSibling = {
  kind: "time",
  tempId: "t1",
  date: "2026-10-16",
  hours: "1.5",
  activity: "Drafting",
  narrative: "",
};

describe("createDeadlineWithCaptures", () => {
  test("stores the due date at UTC midnight (ADR-012) in any server zone", async () => {
    const res = await createDeadlineWithCaptures(
      matterId,
      captureInitialState,
      deadlineForm()
    );
    expect(res.status).toBe("ok");
    const d = await prisma.deadline.findFirstOrThrow({ where: { matterId } });
    expect(d.dueDate.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(d.ownerId).toBe(userId);
  });

  test("an impossible due date is a field error", async () => {
    const res = await createDeadlineWithCaptures(
      matterId,
      captureInitialState,
      deadlineForm({ dueDate: "2026-02-31" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.[0]).toMatch(/invalid/i);
    expect(await prisma.deadline.count()).toBe(0);
  });

  test("a time sibling is linked back to the new deadline", async () => {
    const res = await createDeadlineWithCaptures(
      matterId,
      captureInitialState,
      deadlineForm({ attachments: JSON.stringify([timeSibling]) })
    );
    expect(res.status).toBe("ok");
    const d = await prisma.deadline.findFirstOrThrow({ where: { matterId } });
    const entry = await prisma.timeEntry.findFirstOrThrow({
      where: { matterId },
    });
    expect(entry.deadlineId).toBe(d.id);
    expect(entry.taskId).toBeNull();
    expect(entry.date.toISOString()).toBe("2026-10-16T00:00:00.000Z");
  });

  test("a stale matter id is a form error, not an FK crash, and writes nothing", async () => {
    const res = await createDeadlineWithCaptures(
      "no-such-matter",
      captureInitialState,
      deadlineForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/no longer exists/i);
    expect(await prisma.deadline.count()).toBe(0);
  });
});

describe("createTaskWithCaptures — siblings", () => {
  test("a time sibling is linked to the new task (taskId, source task)", async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({ attachments: JSON.stringify([timeSibling]) })
    );
    expect(res.status).toBe("ok");
    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    const entry = await prisma.timeEntry.findFirstOrThrow({
      where: { matterId },
    });
    expect(entry.taskId).toBe(task.id);
    expect(entry.source).toBe("task");
  });

  test("a sibling note keeps its line breaks and <bracketed> text", async () => {
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      taskForm({
        attachments: JSON.stringify([
          {
            kind: "note_sibling",
            tempId: "n1",
            content: "Call w/ client\nRe: <Smith> deposition",
            type: "note",
            isPinned: false,
          },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({ where: { matterId } });
    expect(note.content).toBe(
      "Call w/ client<br>Re: &lt;Smith&gt; deposition"
    );
    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    expect(note.taskId).toBe(task.id);
  });

  test("a sibling kind the user cannot create stops the whole save (per-kind gate)", async () => {
    vi.mocked(requirePermission).mockImplementation(async (key: string) => {
      if (key === "time_entries.create") throw new Error("NEXT_REDIRECT");
      return "test-user";
    });
    await expect(
      createTaskWithCaptures(
        matterId,
        captureInitialState,
        taskForm({ attachments: JSON.stringify([timeSibling]) })
      )
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.timeEntry.count()).toBe(0);
    vi.mocked(requirePermission).mockResolvedValue("test-user");
  });

  test("a stale matter id is a form error and writes nothing", async () => {
    const res = await createTaskWithCaptures(
      "no-such-matter",
      captureInitialState,
      taskForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/no longer exists/i);
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("createTimeEntryWithCaptures", () => {
  const timeForm = (over: Record<string, string> = {}): FormData => {
    const fd = new FormData();
    fd.set("date", "2026-10-16");
    fd.set("hours", "2");
    fd.set("activity", "Research");
    fd.set("billable", "on");
    for (const [k, v] of Object.entries(over)) fd.set(k, v);
    return fd;
  };

  test("stores the entry date at UTC midnight", async () => {
    const res = await createTimeEntryWithCaptures(
      matterId,
      captureInitialState,
      timeForm()
    );
    expect(res.status).toBe("ok");
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { matterId } });
    expect(e.date.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(e.userId).toBe(userId);
  });

  test("an invalid sibling rejects the whole save (no primary row)", async () => {
    const res = await createTimeEntryWithCaptures(
      matterId,
      captureInitialState,
      timeForm({
        attachments: JSON.stringify([
          { kind: "task", tempId: "x", title: "" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.attachmentErrors?.x?.title?.[0]).toBeTruthy();
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});
