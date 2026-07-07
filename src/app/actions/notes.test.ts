/**
 * Integration tests for the note action surface.
 *
 * Covers:
 *   - createNote association-FK guards: a nonexistent id or an id
 *     belonging to a DIFFERENT matter returns a form error instead of
 *     an unhandled FK-constraint throw / a silent cross-matter link.
 *   - createNote accepts a same-matter association and persists it.
 *   - updateNote never touches isPinned — pinning is gated behind
 *     `notes.pin` (toggleNotePin), so an edit must neither pin nor
 *     un-pin regardless of what the form submits.
 *   - markMatterNotesRead is idempotent (skipDuplicates) — re-marking
 *     already-read notes is one batch statement, no dupes, no throw.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createNote,
  markMatterNotesRead,
  updateNote,
} from "@/app/actions/notes";
import { noteInitialState } from "@/lib/note-constants";
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
let otherMatterId: string;

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
    name: "Matter A",
  });
  matterId = m.matterId;
  const m2 = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
    name: "Matter B",
  });
  otherMatterId = m2.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

const noteForm = (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("content", "<p>Hello world</p>");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const seedNote = async (overrides?: {
  matterId?: string;
  isPinned?: boolean;
  content?: string;
}) => {
  const n = await prisma.note.create({
    data: {
      matterId: overrides?.matterId ?? matterId,
      authorId: userId,
      content: overrides?.content ?? "<p>Seed note</p>",
      isPinned: overrides?.isPinned ?? false,
    },
    select: { id: true },
  });
  return n.id;
};

const seedTaskOn = async (onMatterId: string) => {
  const t = await prisma.task.create({
    data: { matterId: onMatterId, title: "Draft motion" },
    select: { id: true },
  });
  return t.id;
};

describe("createNote — association FK guards", () => {
  test("nonexistent taskId returns a form error, not a thrown FK violation", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ taskId: "no-such-task" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/linked task not found/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("taskId from a DIFFERENT matter is rejected (no cross-matter link)", async () => {
    const foreignTaskId = await seedTaskOn(otherMatterId);
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ taskId: foreignTaskId })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/linked task not found/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("parentNoteId from a DIFFERENT matter is rejected (no cross-matter reply)", async () => {
    const foreignNoteId = await seedNote({ matterId: otherMatterId });
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ parentNoteId: foreignNoteId })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/parent note not found/i);
    // Only the seeded foreign note exists — no reply was created.
    expect(await prisma.note.count()).toBe(1);
  });

  test("same-matter taskId is accepted and persisted on the note", async () => {
    const taskId = await seedTaskOn(matterId);
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ taskId })
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirst({ where: { matterId } });
    expect(note?.taskId).toBe(taskId);
  });
});

describe("updateNote — pinning is out of scope for edits", () => {
  test("editing a pinned note without the checkbox keeps it pinned", async () => {
    const noteId = await seedNote({ isPinned: true });
    const res = await updateNote(
      noteId,
      noteInitialState,
      noteForm({ content: "<p>Edited body</p>" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.note.findUnique({ where: { id: noteId } });
    expect(row?.content).toBe("<p>Edited body</p>");
    expect(row?.isPinned).toBe(true);
  });

  test("submitting isPinned=on does NOT pin (pinning requires toggleNotePin)", async () => {
    const noteId = await seedNote({ isPinned: false });
    const res = await updateNote(
      noteId,
      noteInitialState,
      noteForm({ isPinned: "on" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.note.findUnique({ where: { id: noteId } });
    expect(row?.isPinned).toBe(false);
  });
});

describe("markMatterNotesRead — idempotent batch", () => {
  test("re-marking already-read notes succeeds without duplicating rows", async () => {
    const a = await seedNote();
    const b = await seedNote();

    const first = await markMatterNotesRead([a, b]);
    expect(first.ok).toBe(true);
    // Common revisit path: the whole batch is already read.
    const second = await markMatterNotesRead([a, b]);
    expect(second.ok).toBe(true);

    expect(await prisma.noteRead.count({ where: { userId } })).toBe(2);
  });

  test("mixed batch (one read, one unread) inserts only the missing row", async () => {
    const a = await seedNote();
    const b = await seedNote();
    await markMatterNotesRead([a]);

    const res = await markMatterNotesRead([a, b]);
    expect(res.ok).toBe(true);
    const rows = await prisma.noteRead.findMany({ where: { userId } });
    expect(rows.map((r) => r.noteId).sort()).toEqual([a, b].sort());
  });

  test("unknown ids are ignored — no dangling reads", async () => {
    const res = await markMatterNotesRead(["ghost-note-id"]);
    expect(res.ok).toBe(true);
    expect(await prisma.noteRead.count()).toBe(0);
  });
});
