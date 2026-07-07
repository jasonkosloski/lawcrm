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
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  addCapturesToNoteBulk,
  addDeadlineToNote,
  addTaskToNote,
  addTimeEntryToNote,
} from "@/app/actions/note-attachments";
import {
  bulkAttachInitialState,
  noteAttachmentInitialState,
} from "@/lib/note-attachment-form";
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
    const result = await addTaskToNote(
      noteId,
      noteAttachmentInitialState,
      buildTaskForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
    expect(result.status).toBe("ok");
    const task = await prisma.task.findFirst({ where: { noteId } });
    expect(task?.title).toBe("Follow up with client");
  });

  test("addDeadlineToNote gates on deadlines.create and creates the row", async () => {
    const result = await addDeadlineToNote(
      noteId,
      noteAttachmentInitialState,
      buildDeadlineForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.create");
    expect(result.status).toBe("ok");
    const deadline = await prisma.deadline.findFirst({ where: { noteId } });
    expect(deadline?.title).toBe("Answer due");
  });

  test("addTimeEntryToNote gates on time_entries.create and creates the row", async () => {
    const result = await addTimeEntryToNote(
      noteId,
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.create"
    );
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
      ])
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.create"
    );
    // No deadline/event captures in the payload — those capabilities
    // must not be demanded of the user.
    expect(mockedRequirePermission).not.toHaveBeenCalledWith(
      "deadlines.create"
    );
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
      ])
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("events.create");
    expect(result.status).toBe("ok");
    expect(await prisma.calendarEvent.count({ where: { matterId } })).toBe(1);
  });

  test("note_sibling-only payload requires no create permission", async () => {
    // The bulk loop deliberately ignores note_sibling captures, so
    // there's no row creation to gate.
    const result = await addCapturesToNoteBulk(
      noteId,
      bulkAttachInitialState,
      buildBulkForm([
        { kind: "note_sibling", tempId: "n1", content: "A sibling note" },
      ])
    );
    expect(mockedRequirePermission).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });
});
