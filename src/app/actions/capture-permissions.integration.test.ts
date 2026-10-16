/**
 * End-to-end permission tests for capture-created records and note
 * lifecycle, run against the REAL `permission-check` module + roles
 * in the test DB (only `redirect` is stubbed to a recognisable throw).
 *
 * Pins:
 *   - Every record kind created through a capture (siblings on the
 *     task / event / deadline / time composers, createNote captures,
 *     bulk-attach) must clear its OWN create key — a role holding only
 *     the primary's key cannot mint billable time, deadlines, events,
 *     tasks or pinned notes through a sibling. Denial is atomic: no
 *     rows are written.
 *   - Pinning at create time needs `notes.pin`.
 *   - Deleting a note other people replied to needs `notes.delete_any`
 *     (the cascade would destroy their replies); deletes / edits /
 *     pins write ActivityLog rows.
 *   - Events created via captures carry a creator + default attendees
 *     and are pushed to Google Calendar after commit.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/google/google-calendar-push", () => ({
  pushEventToGoogle: vi.fn().mockResolvedValue(undefined),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import { prisma } from "@/lib/prisma";
import {
  createDeadlineWithCaptures,
  createEventWithCaptures,
  createTaskWithCaptures,
  createTimeEntryWithCaptures,
} from "@/app/actions/captures";
import {
  createNote,
  deleteNote,
  toggleNotePin,
  updateNote,
} from "@/app/actions/notes";
import { addCapturesToNoteBulk } from "@/app/actions/note-attachments";
import { captureInitialState } from "@/lib/capture-schemas";
import { noteInitialState } from "@/lib/note-constants";
import { bulkAttachInitialState } from "@/lib/note-attachment-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedPush = vi.mocked(pushEventToGoogle);

let firmId: string;
let adminRoleId: string;
let matterId: string;
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  const area = await seedPracticeArea();
  areaId = area.areaId;
  stageId = area.stageId;
  const lead = await seedUser({ firmId, email: "lead@example.com" });
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: lead.userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

/** A non-admin user holding exactly `permissions`, acting as them. */
async function actAs(permissions: string[], email = "actor@example.com") {
  const role = await prisma.role.create({
    data: { firmId, name: `role-${email}`, isSystem: false },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId: role.id, permission })),
  });
  const { userId } = await seedUser({ firmId, email, roleIds: [role.id] });
  mockedGetUser.mockResolvedValue(userId);
  return userId;
}

async function actAsAdmin() {
  const { userId } = await seedUser({
    firmId,
    email: "admin@example.com",
    roleIds: [adminRoleId],
  });
  mockedGetUser.mockResolvedValue(userId);
  return userId;
}

const REDIRECT = /__REDIRECT__:\//;

// Capture payloads --------------------------------------------------

const TASK_CAP = { kind: "task", tempId: "t", title: "Sibling task" };
const TIME_CAP = {
  kind: "time",
  tempId: "m",
  date: "2026-07-01",
  hours: "3",
  activity: "Sneaky billable time",
};
const DEADLINE_CAP = {
  kind: "deadline",
  tempId: "d",
  title: "Sibling deadline",
  dueDate: "2026-09-01",
};
const EVENT_CAP = {
  kind: "event",
  tempId: "e",
  title: "Sibling event",
  startTime: "2026-08-01T09:00",
  endTime: "2026-08-01T10:00",
  type: "meeting",
};
const PINNED_NOTE_CAP = {
  kind: "note_sibling",
  tempId: "n",
  content: "<p>Pinned sibling</p>",
  isPinned: true,
};

async function rowCounts() {
  const [tasks, deadlines, events, time, notes] = await Promise.all([
    prisma.task.count(),
    prisma.deadline.count(),
    prisma.calendarEvent.count(),
    prisma.timeEntry.count(),
    prisma.note.count(),
  ]);
  return { tasks, deadlines, events, time, notes };
}

const ZERO = { tasks: 0, deadlines: 0, events: 0, time: 0, notes: 0 };

const primaryTaskForm = (captures: unknown[]) => {
  const fd = new FormData();
  fd.set("title", "Primary task");
  fd.set("attachments", JSON.stringify(captures));
  return fd;
};
const primaryEventForm = (captures: unknown[]) => {
  const fd = new FormData();
  fd.set("title", "Primary event");
  fd.set("startTime", "2026-06-01T09:00");
  fd.set("endTime", "2026-06-01T10:00");
  fd.set("attachments", JSON.stringify(captures));
  return fd;
};
const primaryDeadlineForm = (captures: unknown[]) => {
  const fd = new FormData();
  fd.set("title", "Primary deadline");
  fd.set("dueDate", "2026-10-01");
  fd.set("attachments", JSON.stringify(captures));
  return fd;
};
const primaryTimeForm = (captures: unknown[]) => {
  const fd = new FormData();
  fd.set("date", "2026-06-01");
  fd.set("hours", "1");
  fd.set("activity", "Primary time");
  fd.set("attachments", JSON.stringify(captures));
  return fd;
};
const noteForm = (captures: unknown[] = [], extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("content", "<p>A note</p>");
  fd.set("attachments", JSON.stringify(captures));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
};

// ── Primary composers: siblings need their own keys ─────────────────────

describe("primary captures — siblings need their own create key", () => {
  test("tasks.create alone cannot attach a time entry, deadline, event or pinned note", async () => {
    await actAs(["tasks.create"]);
    for (const cap of [TIME_CAP, DEADLINE_CAP, EVENT_CAP, PINNED_NOTE_CAP]) {
      await expect(
        createTaskWithCaptures(
          matterId,
          captureInitialState,
          primaryTaskForm([cap])
        )
      ).rejects.toThrow(REDIRECT);
    }
    // Atomic: not even the primary task was written.
    expect(await rowCounts()).toEqual(ZERO);
  });

  test("events.create alone cannot attach a task / time entry; deadlines.create alone cannot attach time; time_entries.create alone cannot attach a task", async () => {
    await actAs(["events.create"]);
    await expect(
      createEventWithCaptures(
        matterId,
        captureInitialState,
        primaryEventForm([TIME_CAP])
      )
    ).rejects.toThrow(REDIRECT);
    await expect(
      createEventWithCaptures(
        matterId,
        captureInitialState,
        primaryEventForm([TASK_CAP])
      )
    ).rejects.toThrow(REDIRECT);

    await actAs(["deadlines.create"], "dl@example.com");
    await expect(
      createDeadlineWithCaptures(
        matterId,
        captureInitialState,
        primaryDeadlineForm([TIME_CAP])
      )
    ).rejects.toThrow(REDIRECT);

    await actAs(["time_entries.create"], "te@example.com");
    await expect(
      createTimeEntryWithCaptures(
        matterId,
        captureInitialState,
        primaryTimeForm([TASK_CAP])
      )
    ).rejects.toThrow(REDIRECT);

    expect(await rowCounts()).toEqual(ZERO);
  });

  test("a pinned sibling note needs notes.pin on top of notes.create", async () => {
    await actAs(["tasks.create", "notes.create"]);
    await expect(
      createTaskWithCaptures(
        matterId,
        captureInitialState,
        primaryTaskForm([PINNED_NOTE_CAP])
      )
    ).rejects.toThrow(REDIRECT);
    expect(await rowCounts()).toEqual(ZERO);

    // Unpinned sibling note with notes.create is fine.
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      primaryTaskForm([{ ...PINNED_NOTE_CAP, isPinned: false }])
    );
    expect(res.status).toBe("ok");
    expect(await prisma.note.count()).toBe(1);
  });

  test("holding every needed key succeeds and creates every kind", async () => {
    await actAs([
      "tasks.create",
      "time_entries.create",
      "deadlines.create",
      "events.create",
      "notes.create",
      "notes.pin",
    ]);
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      primaryTaskForm([TIME_CAP, DEADLINE_CAP, EVENT_CAP, PINNED_NOTE_CAP])
    );
    expect(res.status).toBe("ok");
    expect(await rowCounts()).toEqual({
      tasks: 1,
      deadlines: 1,
      events: 1,
      time: 1,
      notes: 1,
    });
    expect((await prisma.note.findFirstOrThrow()).isPinned).toBe(true);
  });

  test("admins pass every sibling gate", async () => {
    await actAsAdmin();
    const res = await createTimeEntryWithCaptures(
      matterId,
      captureInitialState,
      primaryTimeForm([TASK_CAP, DEADLINE_CAP, PINNED_NOTE_CAP])
    );
    expect(res.status).toBe("ok");
    expect((await rowCounts()).time).toBe(1);
  });
});

// ── createNote ──────────────────────────────────────────────────────────

describe("createNote — captures and pinning need their own keys", () => {
  test.each([
    ["task", TASK_CAP],
    ["deadline", DEADLINE_CAP],
    ["event", EVENT_CAP],
    ["time entry", TIME_CAP],
  ])("notes.create alone cannot create a %s capture", async (_label, cap) => {
    await actAs(["notes.create"]);
    await expect(
      createNote(matterId, noteInitialState, noteForm([cap]))
    ).rejects.toThrow(REDIRECT);
    // Atomic: the note itself wasn't written either.
    expect(await rowCounts()).toEqual(ZERO);
  });

  test("notes.create alone cannot create a pinned note or a pinned sibling", async () => {
    await actAs(["notes.create"]);
    await expect(
      createNote(matterId, noteInitialState, noteForm([], { isPinned: "on" }))
    ).rejects.toThrow(REDIRECT);
    await expect(
      createNote(matterId, noteInitialState, noteForm([PINNED_NOTE_CAP]))
    ).rejects.toThrow(REDIRECT);
    expect(await rowCounts()).toEqual(ZERO);
  });

  test("notes.create + notes.pin can pin; notes.create alone can write an unpinned note", async () => {
    await actAs(["notes.create", "notes.pin"]);
    const pinned = await createNote(
      matterId,
      noteInitialState,
      noteForm([], { isPinned: "on" })
    );
    expect(pinned.status).toBe("ok");
    expect((await prisma.note.findFirstOrThrow()).isPinned).toBe(true);

    await actAs(["notes.create"], "plain@example.com");
    const plain = await createNote(matterId, noteInitialState, noteForm());
    expect(plain.status).toBe("ok");
    expect(await prisma.note.count()).toBe(2);
  });

  test("holding each capture key lets the capture through", async () => {
    await actAs(["notes.create", "tasks.create", "time_entries.create"]);
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm([TASK_CAP, TIME_CAP])
    );
    expect(res.status).toBe("ok");
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.timeEntry.count()).toBe(1);
  });
});

// ── Bulk attach (shared helper, same behavior) ──────────────────────────

describe("addCapturesToNoteBulk — still gates the union via the shared helper", () => {
  test("missing a kind's key rejects the whole batch", async () => {
    const authorId = await actAs(["tasks.create"]);
    const note = await prisma.note.create({
      data: { matterId, authorId, content: "<p>Base</p>" },
      select: { id: true },
    });
    const fd = new FormData();
    fd.set("attachments", JSON.stringify([TASK_CAP, TIME_CAP]));
    await expect(
      addCapturesToNoteBulk(note.id, bulkAttachInitialState, fd)
    ).rejects.toThrow(REDIRECT);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

// ── deleteNote: replies + activity log ──────────────────────────────────

describe("deleteNote — cascade vs. other people's replies", () => {
  async function thread() {
    const author = await actAs(["notes.create"], "author@example.com");
    const other = await seedUser({ firmId, email: "other@example.com" });
    const root = await prisma.note.create({
      data: { matterId, authorId: author, content: "<p>Strategy</p>" },
      select: { id: true },
    });
    const reply = await prisma.note.create({
      data: {
        matterId,
        authorId: other.userId,
        parentNoteId: root.id,
        content: "<p>My analysis</p>",
      },
      select: { id: true },
    });
    return { author, other: other.userId, rootId: root.id, replyId: reply.id };
  }

  test("author without notes.delete_any cannot cascade-delete another user's reply", async () => {
    const { rootId, replyId } = await thread();
    const res = await deleteNote(rootId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/replied/i);
    expect(await prisma.note.findUnique({ where: { id: rootId } })).not.toBeNull();
    expect(await prisma.note.findUnique({ where: { id: replyId } })).not.toBeNull();
  });

  test("a deeper reply by someone else (under the author's own reply) also blocks", async () => {
    const { author, other, rootId } = await thread();
    const mine = await prisma.note.create({
      data: { matterId, authorId: author, parentNoteId: rootId, content: "<p>Mine</p>" },
      select: { id: true },
    });
    await prisma.note.create({
      data: { matterId, authorId: other, parentNoteId: mine.id, content: "<p>Deep</p>" },
    });
    // Remove the direct other-user reply so only the deep one remains.
    await prisma.note.deleteMany({
      where: { parentNoteId: rootId, authorId: other },
    });
    const res = await deleteNote(rootId);
    expect(res.ok).toBe(false);
    expect(await prisma.note.count({ where: { id: rootId } })).toBe(1);
  });

  test("author may delete a thread containing only their own replies", async () => {
    const { author, rootId } = await thread();
    await prisma.note.deleteMany({ where: { parentNoteId: rootId } });
    await prisma.note.create({
      data: { matterId, authorId: author, parentNoteId: rootId, content: "<p>Self</p>" },
    });
    const res = await deleteNote(rootId);
    expect(res.ok).toBe(true);
    expect(await prisma.note.count()).toBe(0);
  });

  test("holder of notes.delete_any may delete a thread with others' replies, and it is logged", async () => {
    const { rootId } = await thread();
    await actAs(["notes.delete_any"], "mod@example.com");
    const res = await deleteNote(rootId);
    expect(res.ok).toBe(true);
    expect(await prisma.note.count()).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Note deleted" },
    });
    expect(log.matterId).toBe(matterId);
    expect(log.detail).toContain("Strategy");
    expect(log.detail).toContain("1 reply");
  });

  test("an author-less-permission stranger is still bounced", async () => {
    const { rootId } = await thread();
    await actAs(["notes.create"], "stranger@example.com");
    await expect(deleteNote(rootId)).rejects.toThrow(REDIRECT);
    expect(await prisma.note.count({ where: { id: rootId } })).toBe(1);
  });

  test("a plain delete is activity-logged with the actor", async () => {
    const author = await actAs(["notes.create"]);
    const n = await prisma.note.create({
      data: { matterId, authorId: author, content: "<p>Scratch</p>" },
      select: { id: true },
    });
    expect((await deleteNote(n.id)).ok).toBe(true);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Note deleted" },
    });
    expect(log.userId).toBe(author);
    expect(log.detail).toBe("Scratch");
  });
});

describe("toggleNotePin / updateNote — activity log", () => {
  test("pin and unpin are logged", async () => {
    const userId = await actAs(["notes.pin"]);
    const n = await prisma.note.create({
      data: { matterId, authorId: userId, content: "<p>Key fact</p>" },
      select: { id: true },
    });
    await toggleNotePin(n.id);
    await toggleNotePin(n.id);
    const titles = (await prisma.activityLog.findMany())
      .map((l) => l.title)
      .sort();
    expect(titles).toEqual(["Note pinned", "Note unpinned"]);
  });

  test("edits are logged", async () => {
    const userId = await actAs(["notes.create"]);
    const n = await prisma.note.create({
      data: { matterId, authorId: userId, content: "<p>Old</p>" },
      select: { id: true },
    });
    const fd = new FormData();
    fd.set("content", "<p>New text</p>");
    const res = await updateNote(n.id, noteInitialState, fd);
    expect(res.status).toBe("ok");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Note edited" },
    });
    expect(log.userId).toBe(userId);
    expect(log.detail).toBe("New text");
  });
});

// ── Events: creator, attendees, Google push ─────────────────────────────

describe("capture-created events — creator, attendees, Google push", () => {
  test("Events composer pushes the new event to Google after commit", async () => {
    const userId = await actAs(["events.create"]);
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      primaryEventForm([])
    );
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow();
    expect(ev.createdById).toBe(userId);
    expect(mockedPush).toHaveBeenCalledTimes(1);
    expect(mockedPush).toHaveBeenCalledWith(ev.id);
  });

  test("a sibling event on a task composer gets createdById, the creator as attendee, and is pushed", async () => {
    const userId = await actAs(["tasks.create", "events.create"]);
    const res = await createTaskWithCaptures(
      matterId,
      captureInitialState,
      primaryTaskForm([EVENT_CAP])
    );
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      include: { attendees: true },
    });
    expect(ev.createdById).toBe(userId);
    expect(ev.attendees.some((a) => a.userId === userId)).toBe(true);
    expect(mockedPush).toHaveBeenCalledWith(ev.id);
  });

  test("a sibling event also gets the matter team when auto-add is on", async () => {
    const userId = await actAs(["notes.create", "events.create"]);
    const lead = await prisma.user.findFirstOrThrow({
      where: { email: "lead@example.com" },
    });
    // seedMatter put the lead on the matter team.
    const res = await createNote(
      matterId,
      noteInitialState,
      noteForm([EVENT_CAP])
    );
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      include: { attendees: true },
    });
    expect(ev.createdById).toBe(userId);
    const attendeeIds = ev.attendees.map((a) => a.userId);
    expect(attendeeIds).toContain(userId);
    expect(attendeeIds).toContain(lead.id);
    expect(mockedPush).toHaveBeenCalledWith(ev.id);
  });

  test("bulk-attach events get a creator, attendees and a push", async () => {
    const userId = await actAs(["events.create"]);
    const note = await prisma.note.create({
      data: { matterId, authorId: userId, content: "<p>Base</p>" },
      select: { id: true },
    });
    const fd = new FormData();
    fd.set("attachments", JSON.stringify([EVENT_CAP]));
    const res = await addCapturesToNoteBulk(note.id, bulkAttachInitialState, fd);
    expect(res.status).toBe("ok");
    const ev = await prisma.calendarEvent.findFirstOrThrow({
      include: { attendees: true },
    });
    expect(ev.createdById).toBe(userId);
    expect(ev.attendees.map((a) => a.userId)).toContain(userId);
    expect(mockedPush).toHaveBeenCalledWith(ev.id);
  });
});
