/**
 * Integration tests for the entity-scoped "add a note on this X"
 * actions (task / deadline).
 *
 * Covers:
 *   - RBAC gate: both actions hit `notes.create` — the same key as
 *     the primary composer in notes.ts — and the gate fires BEFORE
 *     any row is written, so a denied user can't author notes through
 *     these side doors.
 *   - Happy path: gate passes → note lands with the parent FK set AND
 *     the author's NoteRead row exists (author starts "read" on their
 *     own note, matching every other note writer).
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
import { addNoteToDeadline, addNoteToTask } from "@/app/actions/note-on-entity";
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
});

afterEach(() => {
  vi.clearAllMocks();
});

const buildNoteForm = (content = "Called the adjuster") => {
  const fd = new FormData();
  fd.set("content", content);
  return fd;
};

const seedTask = async () => {
  const t = await prisma.task.create({
    data: { matterId, title: "Draft motion", status: "open" },
    select: { id: true },
  });
  return t.id;
};

const seedDeadline = async () => {
  const d = await prisma.deadline.create({
    data: { matterId, title: "Discovery cutoff", dueDate: new Date("2026-09-01") },
    select: { id: true },
  });
  return d.id;
};

// ── RBAC gates ──────────────────────────────────────────────────────────

describe("note-on-entity action gates", () => {
  // Bogus parent ids are fine here: the gate must fire before the
  // parent lookup, so the permission call is observable either way.
  test("addNoteToTask gates on notes.create", async () => {
    await addNoteToTask("nope", noteAttachmentInitialState, buildNoteForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("notes.create");
  });

  test("addNoteToDeadline gates on notes.create", async () => {
    await addNoteToDeadline("nope", noteAttachmentInitialState, buildNoteForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("notes.create");
  });

  test("denied permission blocks the write entirely", async () => {
    const taskId = await seedTask();
    // requirePermission redirects (throws) on denial — simulate that.
    mockedRequirePermission.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      addNoteToTask(taskId, noteAttachmentInitialState, buildNoteForm())
    ).rejects.toThrow();
    expect(await prisma.note.count()).toBe(0);
  });
});

// ── Happy path ──────────────────────────────────────────────────────────

describe("addNoteToTask — creation", () => {
  test("creates the note with the task FK and the author's read marker", async () => {
    const taskId = await seedTask();
    const res = await addNoteToTask(
      taskId,
      noteAttachmentInitialState,
      buildNoteForm("Line one\nLine two")
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({
      select: { id: true, taskId: true, matterId: true, authorId: true, content: true },
    });
    expect(note.taskId).toBe(taskId);
    expect(note.matterId).toBe(matterId);
    expect(note.authorId).toBe(userId);
    // Plain-text path converts newlines to <br>.
    expect(note.content).toBe("Line one<br>Line two");
    // Author starts "read" on their own note — without this row the
    // note counts as unread for its own author on the Notes tab.
    const read = await prisma.noteRead.findUnique({
      where: { userId_noteId: { userId, noteId: note.id } },
    });
    expect(read).not.toBeNull();
  });
});

describe("addNoteToDeadline — creation", () => {
  test("creates the note with the deadline FK and the author's read marker", async () => {
    const deadlineId = await seedDeadline();
    const res = await addNoteToDeadline(
      deadlineId,
      noteAttachmentInitialState,
      buildNoteForm()
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({
      select: { id: true, deadlineId: true, matterId: true, authorId: true },
    });
    expect(note.deadlineId).toBe(deadlineId);
    expect(note.matterId).toBe(matterId);
    expect(note.authorId).toBe(userId);
    const read = await prisma.noteRead.findUnique({
      where: { userId_noteId: { userId, noteId: note.id } },
    });
    expect(read).not.toBeNull();
  });
});
