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
 *   - deleteNote is a HARD delete and the schema cascades clean up
 *     the satellite tables: NoteRead + NoteReaction rows (onDelete:
 *     Cascade on both FKs) and reply sub-threads (parentNoteId
 *     Cascade) go with the note, so the read/reaction tables can't
 *     accumulate orphans. Evidence for the "NoteRead table will
 *     grow unbounded" roadmap entry being covered by the schema.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
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
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import { prisma } from "@/lib/prisma";
import {
  createNote,
  deleteNote,
  markMatterNotesRead,
  toggleNotePin,
  toggleNoteReaction,
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

let firmId: string;
let userId: string;
let matterId: string;
let otherMatterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
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
  // Tests that deny a permission replace these; put the defaults back.
  vi.mocked(requirePermission).mockReset().mockResolvedValue("test-user");
  vi.mocked(currentUserHasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(getCurrentUserTimeZone).mockReset().mockResolvedValue("America/Denver");
});

/** Deny these keys for the viewer: the friendly pre-check sees them as
 *  missing AND the enforcing gate throws (as the real redirect does). */
function denyPermissions(...keys: string[]) {
  vi.mocked(currentUserHasPermission).mockImplementation(
    async (key) => !keys.includes(key)
  );
  vi.mocked(requirePermission).mockImplementation(async (key) => {
    if (keys.includes(key)) throw new Error(`NEXT_REDIRECT (denied ${key})`);
    return "test-user";
  });
}

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

describe("deleteNote — hard delete cascades reads + reactions", () => {
  test("deleting a note removes its NoteRead and NoteReaction rows", async () => {
    const noteId = await seedNote();
    const other = await seedUser({ firmId });

    await prisma.noteRead.createMany({
      data: [
        { userId, noteId },
        { userId: other.userId, noteId },
      ],
    });
    await prisma.noteReaction.createMany({
      data: [
        { userId, noteId, emoji: "👍" },
        { userId: other.userId, noteId, emoji: "🔥" },
      ],
    });

    // Author deletes their own note (no notes.delete_any needed).
    const res = await deleteNote(noteId);
    expect(res.ok).toBe(true);

    // Row is GONE (hard delete, not a soft-delete flag) …
    expect(await prisma.note.count()).toBe(0);
    // … and the satellite tables cascaded to zero. This is what
    // makes the "NoteRead grows unbounded" concern a non-issue for
    // the delete path — the FK's onDelete: Cascade does the cleanup.
    expect(await prisma.noteRead.count()).toBe(0);
    expect(await prisma.noteReaction.count()).toBe(0);
  });

  test("deleting a parent note cascades the reply's reads + reactions too", async () => {
    const parentId = await seedNote();
    const reply = await prisma.note.create({
      data: {
        matterId,
        authorId: userId,
        parentNoteId: parentId,
        content: "<p>Reply</p>",
      },
      select: { id: true },
    });
    await prisma.noteRead.create({
      data: { userId, noteId: reply.id },
    });
    await prisma.noteReaction.create({
      data: { userId, noteId: reply.id, emoji: "👍" },
    });

    const res = await deleteNote(parentId);
    expect(res.ok).toBe(true);

    // Reply went with the parent (parentNoteId Cascade), and the
    // reply's read/reaction rows went with the reply.
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.noteRead.count()).toBe(0);
    expect(await prisma.noteReaction.count()).toBe(0);
  });

  test("cascade only touches the deleted note's rows", async () => {
    const doomed = await seedNote();
    const survivor = await seedNote();
    await prisma.noteRead.createMany({
      data: [
        { userId, noteId: doomed },
        { userId, noteId: survivor },
      ],
    });
    await prisma.noteReaction.createMany({
      data: [
        { userId, noteId: doomed, emoji: "👍" },
        { userId, noteId: survivor, emoji: "👍" },
      ],
    });

    const res = await deleteNote(doomed);
    expect(res.ok).toBe(true);

    const reads = await prisma.noteRead.findMany();
    expect(reads).toHaveLength(1);
    expect(reads[0].noteId).toBe(survivor);
    const reactions = await prisma.noteReaction.findMany();
    expect(reactions).toHaveLength(1);
    expect(reactions[0].noteId).toBe(survivor);
  });
});

// ── createNote with captures ────────────────────────────────────────────

const attachments = (items: unknown[]) =>
  noteForm({ attachments: JSON.stringify(items) });

describe("createNote — captures", () => {
  test("task / deadline / time captures are created, linked to the note, with UTC-midnight dates", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        { kind: "task", tempId: "t", title: "Call client", dueDate: "2026-04-15" },
        {
          kind: "deadline",
          tempId: "d",
          title: "Answer due",
          dueDate: "2026-04-16",
        },
        {
          kind: "time",
          tempId: "m",
          date: "2026-04-17",
          hours: "1.5",
          activity: "Memo",
        },
      ])
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({ where: { matterId } });
    const task = await prisma.task.findFirstOrThrow({ where: { matterId } });
    const deadline = await prisma.deadline.findFirstOrThrow({
      where: { matterId },
    });
    const time = await prisma.timeEntry.findFirstOrThrow({
      where: { matterId },
    });
    expect([task.noteId, deadline.noteId, time.noteId]).toEqual([
      note.id,
      note.id,
      note.id,
    ]);
    // Date-only values are calendar dates at UTC midnight (ADR-012).
    expect(task.dueDate?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(deadline.dueDate.toISOString()).toBe("2026-04-16T00:00:00.000Z");
    expect(time.date.toISOString()).toBe("2026-04-17T00:00:00.000Z");
    expect(time.userId).toBe(userId);
    expect(task.ownerId).toBe(userId);
  });

  test("an event capture is stored as the viewer's wall-clock time, owned by them, with attendees, and pushed to Google", async () => {
    // A zone that differs from both the runtime zone (Denver / UTC) and
    // UTC, so a naive parse cannot pass by coincidence in either run.
    vi.mocked(getCurrentUserTimeZone).mockResolvedValue("Pacific/Auckland");
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        {
          kind: "event",
          tempId: "e",
          title: "Status conference",
          startTime: "2026-08-01T09:00",
          endTime: "2026-08-01T10:00",
        },
      ])
    );
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    // 09:00 NZST (UTC+12) = 21:00Z the previous day. A naive
    // `new Date("2026-08-01T09:00")` would store 09:00 in the runtime
    // zone (09:00Z on UTC, 15:00Z in Denver) - never this instant.
    expect(ev.startTime.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(ev.endTime.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(ev.createdById).toBe(userId);
    expect(ev.attendees.map((a) => a.userId)).toContain(userId);
    expect(pushEventToGoogle).toHaveBeenCalledWith(ev.id);
  });

  test("a sibling note capture creates an independent note the author has read", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        { kind: "note_sibling", tempId: "n", content: "<p>Sibling</p>" },
      ])
    );
    expect(res.status).toBe("ok");
    const notes = await prisma.note.findMany({ where: { matterId } });
    expect(notes).toHaveLength(2);
    expect(await prisma.noteRead.count({ where: { userId } })).toBe(2);
  });

  test("invalid captures return per-capture errors and write nothing", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        { kind: "task", tempId: "good", title: "OK" },
        { kind: "deadline", tempId: "bad", title: "No date", dueDate: "" },
      ])
    );
    expect(res.status).toBe("error");
    expect(res.attachmentErrors?.bad).toBeTruthy();
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });

  test("malformed attachments JSON is a form error, not a throw", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ attachments: "{nope" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/malformed/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("the activity preview decodes entities ('&amp;' reads '&')", async () => {
    await createNote(
      matterId,
      noteInitialState,
      noteForm({ content: "<p>Call Smith &amp; Jones</p>" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: "Note added" },
    });
    expect(log.detail).toBe("Call Smith & Jones");
  });
});

describe("createNote — permission gates", () => {
  test("gates on notes.create, and on each capture kind's own create key", async () => {
    await createNote(
      matterId,
      noteInitialState,
      attachments([
        { kind: "task", tempId: "t", title: "T" },
        {
          kind: "time",
          tempId: "m",
          date: "2026-04-17",
          hours: "1",
          activity: "A",
        },
      ])
    );
    const asked = vi.mocked(requirePermission).mock.calls.map((c) => c[0]);
    expect(asked).toEqual(
      expect.arrayContaining(["notes.create", "tasks.create", "time_entries.create"])
    );
    expect(asked).not.toContain("deadlines.create");
    expect(asked).not.toContain("events.create");
    expect(asked).not.toContain("notes.pin");
  });

  test("a denied capture kind returns a form error (typed input kept) and writes nothing", async () => {
    denyPermissions("time_entries.create");
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        {
          kind: "time",
          tempId: "m",
          date: "2026-04-17",
          hours: "1",
          activity: "Billable?",
        },
      ])
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/permission to log time/i);
    expect(res.values?.content).toBe("<p>Hello world</p>");
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("notes.create alone cannot mint tasks, deadlines, events or time", async () => {
    denyPermissions(
      "tasks.create",
      "deadlines.create",
      "events.create",
      "time_entries.create"
    );
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        { kind: "task", tempId: "t", title: "T" },
        {
          kind: "event",
          tempId: "e",
          title: "E",
          startTime: "2026-08-01T09:00",
          endTime: "2026-08-01T10:00",
        },
      ])
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/create tasks and create events/i);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  test("pinning needs notes.pin: denied -> error, nothing saved", async () => {
    denyPermissions("notes.pin");
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ isPinned: "on" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/pin notes/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("pinning with notes.pin saves a pinned note", async () => {
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm({ isPinned: "on" })
    );
    expect(res.status).toBe("ok");
    expect(vi.mocked(requirePermission)).toHaveBeenCalledWith("notes.pin");
    expect((await prisma.note.findFirstOrThrow()).isPinned).toBe(true);
  });

  test("a pinned sibling note also needs notes.pin", async () => {
    denyPermissions("notes.pin");
    const res = await createNote(
      matterId,
      noteInitialState,
      attachments([
        {
          kind: "note_sibling",
          tempId: "n",
          content: "Pin me",
          isPinned: true,
        },
      ])
    );
    expect(res.status).toBe("error");
    expect(await prisma.note.count()).toBe(0);
  });

  test("the enforcing gate still stops a request the friendly check let through", async () => {
    // currentUserHasPermission says yes, requirePermission says no
    // (e.g. a stale cache): nothing may be written.
    vi.mocked(requirePermission).mockImplementation(async (key) => {
      if (key === "tasks.create") throw new Error("NEXT_REDIRECT");
      return "test-user";
    });
    await expect(
      createNote(
        matterId,
        noteInitialState,
        attachments([{ kind: "task", tempId: "t", title: "T" }])
      )
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });
});

// ── deleteNote gating ───────────────────────────────────────────────────

describe("deleteNote — author vs notes.delete_any", () => {
  let otherId: string;
  beforeEach(async () => {
    otherId = (await seedUser({ firmId })).userId;
  });

  test("the author deletes without ever asking for notes.delete_any", async () => {
    const noteId = await seedNote();
    const res = await deleteNote(noteId);
    expect(res.ok).toBe(true);
    expect(vi.mocked(requirePermission)).not.toHaveBeenCalledWith(
      "notes.delete_any"
    );
  });

  test("a non-author must clear notes.delete_any; when denied the note survives", async () => {
    const noteId = await seedNote();
    mockedGetUser.mockResolvedValue(otherId);
    denyPermissions("notes.delete_any");
    await expect(deleteNote(noteId)).rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(requirePermission)).toHaveBeenCalledWith(
      "notes.delete_any"
    );
    expect(await prisma.note.count()).toBe(1);
  });

  test("a non-author WITH notes.delete_any can delete", async () => {
    const noteId = await seedNote();
    mockedGetUser.mockResolvedValue(otherId);
    const res = await deleteNote(noteId);
    expect(res.ok).toBe(true);
    expect(await prisma.note.count()).toBe(0);
  });

  test("the author cannot cascade-delete other people's replies without notes.delete_any", async () => {
    const parentId = await seedNote();
    await prisma.note.create({
      data: {
        matterId,
        authorId: otherId,
        parentNoteId: parentId,
        content: "<p>Colleague's reply</p>",
      },
    });
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await deleteNote(parentId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/replied/i);
    // Both survive.
    expect(await prisma.note.count()).toBe(2);
  });

  test("with notes.delete_any the thread goes, and the audit entry counts the replies", async () => {
    const parentId = await seedNote();
    await prisma.note.create({
      data: {
        matterId,
        authorId: otherId,
        parentNoteId: parentId,
        content: "<p>Colleague's reply</p>",
      },
    });
    const res = await deleteNote(parentId);
    expect(res.ok).toBe(true);
    expect(await prisma.note.count()).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: "Note deleted" },
    });
    expect(log.detail).toMatch(/\(\+ 1 reply\)/);
  });

  test("replies nested deeper than one level are counted too", async () => {
    const parentId = await seedNote();
    const mid = await prisma.note.create({
      data: { matterId, authorId: userId, parentNoteId: parentId, content: "<p>mine</p>" },
    });
    await prisma.note.create({
      data: { matterId, authorId: otherId, parentNoteId: mid.id, content: "<p>deep</p>" },
    });
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await deleteNote(parentId);
    expect(res.ok).toBe(false);
    expect(await prisma.note.count()).toBe(3);
  });
});

describe("toggleNotePin / updateNote gates", () => {
  test("toggleNotePin requires notes.pin (no author bypass) and flips the pin", async () => {
    const noteId = await seedNote();
    await toggleNotePin(noteId);
    expect(vi.mocked(requirePermission)).toHaveBeenCalledWith("notes.pin");
    expect((await prisma.note.findUniqueOrThrow({ where: { id: noteId } })).isPinned).toBe(true);
    await toggleNotePin(noteId);
    expect((await prisma.note.findUniqueOrThrow({ where: { id: noteId } })).isPinned).toBe(false);
  });

  test("toggleNotePin denied: the pin does not change", async () => {
    const noteId = await seedNote();
    denyPermissions("notes.pin");
    await expect(toggleNotePin(noteId)).rejects.toThrow("NEXT_REDIRECT");
    expect((await prisma.note.findUniqueOrThrow({ where: { id: noteId } })).isPinned).toBe(false);
  });

  test("updateNote: the author never asks for notes.edit_any; a non-author must", async () => {
    const noteId = await seedNote();
    await updateNote(noteId, noteInitialState, noteForm({}));
    expect(vi.mocked(requirePermission)).not.toHaveBeenCalledWith(
      "notes.edit_any"
    );

    const other = await seedUser({ firmId });
    mockedGetUser.mockResolvedValue(other.userId);
    denyPermissions("notes.edit_any");
    await expect(
      updateNote(noteId, noteInitialState, noteForm({ content: "<p>Hijack</p>" }))
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: noteId } })).content
    ).toBe("<p>Hello world</p>");
  });
});

// ── Reactions ───────────────────────────────────────────────────────────

describe("toggleNoteReaction", () => {
  test("adds then removes the viewer's reaction", async () => {
    const noteId = await seedNote();
    expect((await toggleNoteReaction(noteId, "👍")).ok).toBe(true);
    expect(await prisma.noteReaction.count({ where: { noteId } })).toBe(1);
    expect((await toggleNoteReaction(noteId, "👍")).ok).toBe(true);
    expect(await prisma.noteReaction.count({ where: { noteId } })).toBe(0);
  });

  test("rejects an emoji outside the palette and an unknown note", async () => {
    const noteId = await seedNote();
    expect((await toggleNoteReaction(noteId, "💩")).ok).toBe(false);
    expect((await toggleNoteReaction("ghost", "👍")).ok).toBe(false);
  });

  test("simultaneous toggles never throw (the old read-then-write raised P2002/P2025)", async () => {
    const noteId = await seedNote();
    const results = await Promise.all([
      toggleNoteReaction(noteId, "🔥"),
      toggleNoteReaction(noteId, "🔥"),
      toggleNoteReaction(noteId, "🔥"),
      toggleNoteReaction(noteId, "🔥"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    // Whatever the interleaving, there is at most one row for the key.
    expect(
      await prisma.noteReaction.count({ where: { noteId, userId } })
    ).toBeLessThanOrEqual(1);
  });
});
