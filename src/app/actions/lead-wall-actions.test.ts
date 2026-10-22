/**
 * Integration: server actions honour the restricted-intake wall
 * (ADR-049). Permission keys are granted; only the wall decides. A
 * non-member gets notFound() on the lead's own actions and on its
 * children reached by id; a team member gets through.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(async () => currentUser),
  requirePermissions: vi.fn(async () => currentUser),
  currentUserHasPermission: vi.fn(async () => true),
  getCurrentUserPermissions: vi.fn(async () => new Set<string>()),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { declineLead } from "@/app/actions/leads";
import { runLeadConflictCheck } from "@/app/actions/conflict-check";
import { createLeadNote, deleteNote } from "@/app/actions/notes";
import { setTaskStatus } from "@/app/actions/tasks";
import { deleteTimeEntry } from "@/app/actions/time-entries";
import { deleteCalendarEvent } from "@/app/actions/calendar-events";
import { noteInitialState } from "@/lib/note-constants";
import { resetDb, seedFirm, seedLead, seedTimeEntry, seedUser } from "@/test/integration-helpers";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/;
let currentUser = "";
let alice: string; // on the lead team
let bob: string; // not
let leadId: string;

function as(userId: string) {
  currentUser = userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: alice } = await seedUser({ firmId }));
  ({ userId: bob } = await seedUser({ firmId }));
  ({ leadId } = await seedLead({ restricted: true, teamUserIds: [alice] }));
  as(bob);
});

describe("lead actions", () => {
  test("a non-member can't note, decline or conflict-check a restricted lead", async () => {
    await expect(
      createLeadNote(leadId, noteInitialState, form({ content: "<p>hi</p>" })),
    ).rejects.toThrow(NOT_FOUND);
    await expect(declineLead(leadId, { status: "idle" }, form({}))).rejects.toThrow(NOT_FOUND);
    await expect(runLeadConflictCheck(leadId)).rejects.toThrow(NOT_FOUND);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stage).toBe("new");
    expect(await prisma.note.count()).toBe(0);
  });

  test("a team member can decline it", async () => {
    as(alice);
    await declineLead(leadId, { status: "idle" }, form({}));
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stage).toBe("declined");
  });
});

describe("children reached by id", () => {
  test("a non-member can't touch a restricted lead's note, task, time or event", async () => {
    const note = await prisma.note.create({
      data: { leadId, authorId: alice, content: "x" },
    });
    const task = await prisma.task.create({ data: { title: "t", leadId } });
    const { timeEntryId } = await seedTimeEntry({ leadId, userId: alice });
    const event = await prisma.calendarEvent.create({
      data: {
        title: "consult",
        leadId,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600_000),
        createdById: alice,
      },
    });
    await expect(deleteNote(note.id)).rejects.toThrow(NOT_FOUND);
    await expect(setTaskStatus(task.id, "done")).rejects.toThrow(NOT_FOUND);
    await expect(deleteTimeEntry(timeEntryId)).rejects.toThrow(NOT_FOUND);
    await expect(deleteCalendarEvent(event.id)).rejects.toThrow(NOT_FOUND);
    expect(await prisma.note.count()).toBe(1);
    expect(await prisma.timeEntry.count()).toBe(1);
    expect(await prisma.calendarEvent.count()).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).not.toBe(
      "done",
    );
  });
});
