/**
 * Integration tests for the note-attachment action surface.
 *
 * Focus: RBAC gates. Attaching a task / deadline / time entry to a
 * saved note creates the exact same rows as the standalone composers
 * in `captures.ts`, so each action must hit the same permission key
 * (`tasks.create` / `deadlines.create` / `time_entries.create`) — and
 * the bulk path must gate the union of the capture kinds present in
 * its payload. Row creation is asserted alongside each gate so a
 * passing gate check can't hide a short-circuited no-op.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
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

// server-only; the viewer's profile zone drives event wall-clock times.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn().mockResolvedValue("America/Denver"),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import { prisma } from "@/lib/prisma";
import {
  addCapturesToNoteBulk,
  addDeadlineToNote,
  addTaskToNote,
  addTimeEntryToNote,
} from "@/app/actions/note-attachments";
import { bulkAttachInitialState, noteAttachmentInitialState } from "@/lib/note-attachment-form";
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
let noteId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "author@example.com" });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
  const note = await prisma.note.create({
    data: { matterId, authorId: userId, content: "<p>Base note</p>" },
    select: { id: true },
  });
  noteId = note.id;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockReset().mockResolvedValue("test-user");
  vi.mocked(currentUserHasPermission).mockReset().mockResolvedValue(true);
});

const buildTaskForm = () => {
  const fd = new FormData();
  fd.set("title", "Follow up with client");
  fd.set("priority", "normal");
  return fd;
};

const buildDeadlineForm = () => {
  const fd = new FormData();
  fd.set("title", "Answer due");
  fd.set("dueDate", "2026-08-01");
  fd.set("kind", "manual");
  return fd;
};

const buildTimeForm = () => {
  const fd = new FormData();
  fd.set("date", "2026-07-01");
  fd.set("hours", "1.5");
  fd.set("activity", "Call re: note");
  return fd;
};

const buildBulkForm = (captures: unknown[]) => {
  const fd = new FormData();
  fd.set("attachments", JSON.stringify(captures));
  return fd;
};

// ── Single-attach gates ─────────────────────────────────────────────────

describe("note-attachment action gates", () => {
  test("addTaskToNote gates on tasks.create and creates the row", async () => {
    const result = await addTaskToNote(noteId, noteAttachmentInitialState, buildTaskForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
    expect(result.status).toBe("ok");
    const task = await prisma.task.findFirst({ where: { noteId } });
    expect(task?.title).toBe("Follow up with client");
  });

  test("addDeadlineToNote gates on deadlines.create and creates the row", async () => {
    const result = await addDeadlineToNote(noteId, noteAttachmentInitialState, buildDeadlineForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.create");
    expect(result.status).toBe("ok");
    const deadline = await prisma.deadline.findFirst({ where: { noteId } });
    expect(deadline?.title).toBe("Answer due");
  });

  test("addTimeEntryToNote gates on time_entries.create and creates the row", async () => {
    const result = await addTimeEntryToNote(noteId, noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
    expect(result.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirst({ where: { noteId } });
    expect(entry?.activity).toBe("Call re: note");
  });
});

// ── Bulk-attach gate (union of kinds) ───────────────────────────────────

describe("addCapturesToNoteBulk gates", () => {
  test("gates on the union of kinds present — and only those", async () => {
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "task", tempId: "t1", title: "Bulk task" },
        {
          kind: "time",
          tempId: "t2",
          date: "2026-07-01",
          hours: "0.5",
          activity: "Bulk time",
        },
      ]),
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
    // No deadline/event captures in the payload — those capabilities
    // must not be demanded of the user.
    expect(mockedRequirePermission).not.toHaveBeenCalledWith("deadlines.create");
    expect(mockedRequirePermission).not.toHaveBeenCalledWith("events.create");
    expect(result.status).toBe("ok");
    expect(await prisma.task.count({ where: { noteId } })).toBe(1);
    expect(await prisma.timeEntry.count({ where: { noteId } })).toBe(1);
  });

  test("event captures gate on events.create", async () => {
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        {
          kind: "event",
          tempId: "e1",
          title: "Status conference",
          startTime: "2026-08-01T09:00",
          endTime: "2026-08-01T10:00",
          type: "hearing",
        },
      ]),
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("events.create");
    expect(result.status).toBe("ok");
    expect(await prisma.calendarEvent.count({ where: { matterId } })).toBe(1);
  });

  test("a note_sibling-only payload is rejected as nothing to save (no phantom success or activity row)", async () => {
    // Replies belong to the reply composer: the bulk surface drops
    // note_sibling captures. It used to return ok and log
    // "1 item added to note" for a payload that wrote nothing.
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([{ kind: "note_sibling", tempId: "n1", content: "A sibling note" }]),
    );
    expect(result.status).toBe("error");
    expect(result.errors?.attachments?.[0]).toBe("Nothing to save");
    expect(mockedRequirePermission).not.toHaveBeenCalled();
    expect(await prisma.note.count()).toBe(1); // just the base note
    expect(await prisma.activityLog.count({ where: { matterId } })).toBe(0);
  });

  test("siblings mixed with real captures are dropped and not counted", async () => {
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "task", tempId: "t1", title: "Real task" },
        { kind: "note_sibling", tempId: "n1", content: "ignored" },
      ]),
    );
    expect(result.status).toBe("ok");
    expect(await prisma.note.count()).toBe(1);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId },
    });
    expect(log.title).toBe("1 item added to note");
    expect(log.detail).toBe("1 task");
  });

  test("activity detail pluralizes by label: '2 time entries', not '2 times'", async () => {
    await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "time", tempId: "a", date: "2026-07-01", hours: "1", activity: "A" },
        { kind: "time", tempId: "b", date: "2026-07-02", hours: "1", activity: "B" },
        { kind: "task", tempId: "c", title: "T" },
        { kind: "deadline", tempId: "d", title: "D1", dueDate: "2026-08-01" },
        { kind: "deadline", tempId: "e", title: "D2", dueDate: "2026-08-02" },
      ]),
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId },
    });
    expect(log.title).toBe("5 items added to note");
    expect(log.detail).toBe("2 time entries · 1 task · 2 deadlines");
  });

  test("a denied kind returns a form error and nothing is created", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "deadlines.create",
    );
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "task", tempId: "t1", title: "Fine" },
        {
          kind: "deadline",
          tempId: "d1",
          title: "Denied",
          dueDate: "2026-08-01",
        },
      ]),
    );
    expect(result.status).toBe("error");
    expect(result.errors?.attachments?.[0]).toMatch(/permission to create deadlines/i);
    // All-or-nothing: the permitted task was not created either.
    expect(await prisma.task.count({ where: { noteId } })).toBe(0);
    expect(await prisma.deadline.count({ where: { noteId } })).toBe(0);
  });

  test("the enforcing gate still rejects when the friendly check is bypassed", async () => {
    mockedRequirePermission.mockImplementation(async (key) => {
      if (key === "tasks.create") throw new Error("NEXT_REDIRECT");
      return "test-user";
    });
    await expect(
      addCapturesToNoteBulk(
        noteId,
        bulkAttachInitialState,
        buildBulkForm([{ kind: "task", tempId: "t1", title: "T" }]),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.task.count({ where: { noteId } })).toBe(0);
  });

  test("an event capture is stored in the viewer's zone, owned, attended, and pushed", async () => {
    await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        {
          kind: "event",
          tempId: "e1",
          title: "Status conference",
          startTime: "2026-08-01T09:00",
          endTime: "2026-08-01T10:00",
          type: "hearing",
        },
      ]),
    );
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    // 09:00 MDT = 15:00Z (not 09:00Z, which a naive server-zone parse
    // gives on the UTC host).
    expect(ev.startTime.toISOString()).toBe("2026-08-01T15:00:00.000Z");
    expect(ev.createdById).toBe(userId);
    expect(ev.attendees.map((a) => a.userId)).toContain(userId);
    expect(pushEventToGoogle).toHaveBeenCalledWith(ev.id);
  });

  test("date-only captures are stored as UTC-midnight calendar dates", async () => {
    await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "deadline", tempId: "d", title: "D", dueDate: "2026-04-16" },
        {
          kind: "time",
          tempId: "m",
          date: "2026-04-17",
          hours: "1",
          activity: "A",
        },
      ]),
    );
    expect(
      (await prisma.deadline.findFirstOrThrow({ where: { noteId } })).dueDate.toISOString(),
    ).toBe("2026-04-16T00:00:00.000Z");
    expect(
      (await prisma.timeEntry.findFirstOrThrow({ where: { noteId } })).date.toISOString(),
    ).toBe("2026-04-17T00:00:00.000Z");
  });

  test("an invalid capture returns attachmentErrors keyed by tempId and writes nothing", async () => {
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "task", tempId: "ok", title: "Fine" },
        {
          kind: "time",
          tempId: "bad",
          date: "2026-07-01",
          hours: "99",
          activity: "A",
        },
      ]),
    );
    expect(result.status).toBe("error");
    expect(result.attachmentErrors?.bad).toBeTruthy();
    expect(await prisma.task.count({ where: { noteId } })).toBe(0);
  });
});

describe("single-attach date handling", () => {
  test("addDeadlineToNote stores the due date at UTC midnight", async () => {
    await addDeadlineToNote(noteId, noteAttachmentInitialState, buildDeadlineForm());
    expect(
      (await prisma.deadline.findFirstOrThrow({ where: { noteId } })).dueDate.toISOString(),
    ).toBe("2026-08-01T00:00:00.000Z");
  });

  test("addTimeEntryToNote stores the date at UTC midnight and rejects a bad date", async () => {
    await addTimeEntryToNote(noteId, noteAttachmentInitialState, buildTimeForm());
    expect(
      (await prisma.timeEntry.findFirstOrThrow({ where: { noteId } })).date.toISOString(),
    ).toBe("2026-07-01T00:00:00.000Z");

    const bad = buildTimeForm();
    bad.set("date", "2026-02-31");
    const res = await addTimeEntryToNote(noteId, noteAttachmentInitialState, bad);
    expect(res.status).toBe("error");
    expect(res.errors?.date?.[0]).toBe("Invalid date");
  });
});
