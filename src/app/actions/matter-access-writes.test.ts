/**
 * Integration tests: matter-scoped server actions enforce the matter
 * wall (TEAM mode) on top of their permission key. Real Postgres and
 * the real permission-check; only auth + Next plumbing are stubbed.
 *
 * An outsider holding every needed permission is still rejected with
 * notFound() and nothing is written; a team member's same call works.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/google/google-calendar-push", () => ({
  pushEventToGoogle: vi.fn().mockResolvedValue(undefined),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { createNote, deleteNote } from "@/app/actions/notes";
import { createTimeEntry, deleteTimeEntry } from "@/app/actions/time-entries";
import { createExpense } from "@/app/actions/expenses";
import { setTaskStatus, deleteTask } from "@/app/actions/tasks";
import { createTaskWithCaptures } from "@/app/actions/captures";
import { createFolder, moveDocuments } from "@/app/actions/document-folders";
import { deleteDocument } from "@/app/actions/documents";
import { setMatterPin } from "@/app/actions/matter-pins";
import { captureInitialState } from "@/lib/capture-schemas";
import { noteInitialState } from "@/lib/note-constants";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);

const PERMS = [
  "notes.create",
  "notes.delete_any",
  "time_entries.create",
  "time_entries.delete_any",
  "matters.expense.create",
  "tasks.create",
  "tasks.edit",
  "tasks.delete",
  "documents.folder.create",
  "documents.organize",
];

let member: string;
let outsider: string;
let matterId: string;

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: "TEAM" },
  });
  const role = await prisma.role.create({
    data: { firmId, name: "Staff", isSystem: false },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: PERMS.map((permission) => ({ roleId: role.id, permission })),
  });
  ({ userId: member } = await seedUser({ firmId, roleIds: [role.id] }));
  ({ userId: outsider } = await seedUser({ firmId, roleIds: [role.id] }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: member,
  }));
});

describe("outsider (not on the matter team) is walled off", () => {
  beforeEach(() => mockedUser.mockResolvedValue(outsider));

  test("createNote -> not found, no row", async () => {
    await expect(
      createNote(matterId, noteInitialState, fd({ content: "<p>hi</p>", type: "note" }))
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.note.count()).toBe(0);
  });

  test("createTimeEntry -> not found, no row", async () => {
    await expect(
      createTimeEntry(
        matterId,
        { status: "idle" } as never,
        fd({ date: "2026-04-01", hours: "1", activity: "Drafting", billable: "on" })
      )
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("createExpense -> not found, no row", async () => {
    await expect(
      createExpense(
        matterId,
        { status: "idle" } as never,
        fd({ date: "2026-04-01", amount: "10", description: "Filing fee", category: "filing" })
      )
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.expense.count()).toBe(0);
  });

  test("createTaskWithCaptures -> not found, no row", async () => {
    await expect(
      createTaskWithCaptures(
        matterId,
        captureInitialState as never,
        fd({ title: "Sneaky task" })
      )
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.task.count()).toBe(0);
  });

  test("setTaskStatus / deleteTask on a matter task -> not found, unchanged", async () => {
    const task = await prisma.task.create({
      data: { matterId, title: "Existing", status: "open" },
      select: { id: true },
    });
    await expect(setTaskStatus(task.id, "done")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(deleteTask(task.id)).rejects.toThrow("NEXT_NOT_FOUND");
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.status).toBe("open");
  });

  test("deleteTimeEntry / deleteNote reached by child id -> not found, row kept", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId: member });
    await expect(deleteTimeEntry(timeEntryId)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.timeEntry.count()).toBe(1);

    const note = await prisma.note.create({
      data: { matterId, authorId: member, content: "secret", type: "note" },
      select: { id: true },
    });
    await expect(deleteNote(note.id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.note.count()).toBe(1);
  });

  test("document actions: delete, folder create, move -> not found", async () => {
    const { documentId } = await seedDocument({ matterId, uploadedBy: member });
    await expect(deleteDocument(documentId)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(createFolder(matterId, null, "Wall")).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    await expect(moveDocuments([documentId], null)).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(await prisma.document.count()).toBe(1);
    expect(await prisma.documentFolder.count()).toBe(0);
  });

  test("pinning a hidden matter is refused", async () => {
    await expect(setMatterPin(matterId, true)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.userMatterPin.count()).toBe(0);
  });
});

describe("team member (and FIRM-mode firms) keep working", () => {
  test("a team member can write notes, time and folders", async () => {
    mockedUser.mockResolvedValue(member);
    const note = await createNote(
      matterId,
      noteInitialState,
      fd({ content: "<p>hello</p>", type: "note" })
    );
    expect(note.status).toBe("ok");
    expect(await prisma.note.count()).toBe(1);

    const te = await createTimeEntry(
      matterId,
      { status: "idle" } as never,
      fd({ date: "2026-04-01", hours: "1", activity: "Drafting", billable: "on" })
    );
    expect(te.status).toBe("ok");
    expect(await prisma.timeEntry.count()).toBe(1);

    const folder = await createFolder(matterId, null, "Pleadings");
    expect(folder.ok).toBe(true);
  });

  test("FIRM mode: a non-member write succeeds (pre-wall behaviour)", async () => {
    await prisma.firm.updateMany({ data: { matterVisibility: "FIRM" } });
    mockedUser.mockResolvedValue(outsider);
    const note = await createNote(
      matterId,
      noteInitialState,
      fd({ content: "<p>open firm</p>", type: "note" })
    );
    expect(note.status).toBe("ok");
  });

  test("a view_all holder is not walled", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: "Staff" } });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permission: "matters.view_all" },
    });
    mockedUser.mockResolvedValue(outsider);
    const note = await createNote(
      matterId,
      noteInitialState,
      fd({ content: "<p>view all</p>", type: "note" })
    );
    expect(note.status).toBe("ok");
  });
});
