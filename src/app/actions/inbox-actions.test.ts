/**
 * Integration tests for the inbox promotion actions (email thread /
 * messenger item → task / deadline / note).
 *
 * Covers:
 *   - RBAC: each of the six actions gates on the matching create key
 *     (tasks.create / deadlines.create / notes.create) — promotion is
 *     the same capability as direct creation, no separate key
 *   - happy paths: source FK set on the spawned row so the
 *     reverse-link chip can render; matter resolved from the source
 *   - unfiled sources error instead of creating orphaned entities
 *   - messenger matter resolution falls back to thread.defaultMatterId
 *   - note body sanitization + shared empty-note detection
 *     (isEffectivelyEmpty from @/lib/sanitize-html, same as createNote)
 *   - note `type` accepts the shared NOTE_TYPES enum
 *
 * Auth + permission gates are stubbed; the gate itself is covered by
 * permission-check.integration.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { inboxActionInitialState } from "@/lib/inbox-action-form";
import {
  createTaskFromEmail,
  createDeadlineFromEmail,
  createNoteFromEmail,
  createTaskFromMessage,
  createDeadlineFromMessage,
  createNoteFromMessage,
} from "@/app/actions/inbox-actions";
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
let emailThreadId: string;
let messengerItemId: string;

/** Unique suffix so repeat seeds inside one test don't collide with the
 *  (userId, emailAddress) / (provider, phoneNumber) unique constraints. */
let seq = 0;
const next = () => ++seq;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const taskForm = (overrides: Record<string, string> = {}) =>
  form({ title: "Draft response", priority: "normal", ...overrides });

const deadlineForm = (overrides: Record<string, string> = {}) =>
  form({
    title: "Answer due",
    dueDate: "2026-08-01",
    kind: "manual",
    ...overrides,
  });

const noteForm = (overrides: Record<string, string> = {}) =>
  form({ content: "<p>Client confirmed the timeline.</p>", ...overrides });

/** Seed an EmailThread filed (or not) to the test matter. */
async function seedEmailThread(opts: { matterId: string | null }) {
  const account = await prisma.emailAccount.create({
    data: { userId, emailAddress: `test-${next()}@lawcrm.test` },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      matterId: opts.matterId,
      subject: "Re: Discovery",
      lastMessageAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  return thread.id;
}

/** Seed a MessengerThread + one item. `itemMatterId` / `defaultMatterId`
 *  let tests exercise both halves of the matter fallback. */
async function seedMessengerItem(opts: {
  itemMatterId: string | null;
  defaultMatterId: string | null;
}) {
  const account = await prisma.messengerAccount.create({
    data: { phoneNumber: `+1303555${String(next()).padStart(4, "0")}` },
    select: { id: true },
  });
  const thread = await prisma.messengerThread.create({
    data: {
      accountId: account.id,
      contactPhone: "+13035550199",
      defaultMatterId: opts.defaultMatterId,
      lastItemAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  const item = await prisma.messengerItem.create({
    data: {
      threadId: thread.id,
      providerEventId: `evt-${next()}`,
      kind: "sms",
      direction: "inbound",
      fromNumber: "+13035550199",
      toNumber: "+13035550100",
      body: "Can we meet Thursday?",
      matterId: opts.itemMatterId,
      occurredAt: new Date("2026-06-01T10:00:00Z"),
    },
    select: { id: true },
  });
  return { itemId: item.id, threadId: thread.id };
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  mockedRequirePermission.mockClear();
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
  emailThreadId = await seedEmailThread({ matterId });
  const mi = await seedMessengerItem({
    itemMatterId: matterId,
    defaultMatterId: null,
  });
  messengerItemId = mi.itemId;
});

// ── RBAC gate ───────────────────────────────────────────────────────────
//
// The module-level `vi.mock("@/lib/permission-check", ...)` at the
// top stubs requirePermission so the action-logic tests don't have
// to set up gates. The mocked function is a spy — read `.mock.calls`
// to verify each action wired the gate to the right key.

describe("inbox action gates", () => {
  test("createTaskFromEmail gates on tasks.create", async () => {
    await createTaskFromEmail(emailThreadId, inboxActionInitialState, taskForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
  });

  test("createDeadlineFromEmail gates on deadlines.create", async () => {
    await createDeadlineFromEmail(
      emailThreadId,
      inboxActionInitialState,
      deadlineForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.create");
  });

  test("createNoteFromEmail gates on notes.create", async () => {
    await createNoteFromEmail(emailThreadId, inboxActionInitialState, noteForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("notes.create");
  });

  test("createTaskFromMessage gates on tasks.create", async () => {
    await createTaskFromMessage(
      messengerItemId,
      inboxActionInitialState,
      taskForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("tasks.create");
  });

  test("createDeadlineFromMessage gates on deadlines.create", async () => {
    await createDeadlineFromMessage(
      messengerItemId,
      inboxActionInitialState,
      deadlineForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.create");
  });

  test("createNoteFromMessage gates on notes.create", async () => {
    await createNoteFromMessage(
      messengerItemId,
      inboxActionInitialState,
      noteForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("notes.create");
  });
});

// ── Email thread → ... ──────────────────────────────────────────────────

describe("email promotions", () => {
  test("createTaskFromEmail files the task to the thread's matter with the source FK", async () => {
    const res = await createTaskFromEmail(
      emailThreadId,
      inboxActionInitialState,
      taskForm({ dueDate: "2026-07-15", priority: "high" })
    );
    expect(res.status).toBe("ok");
    const task = await prisma.task.findFirstOrThrow({
      where: { emailThreadId },
    });
    expect(task.matterId).toBe(matterId);
    expect(task.title).toBe("Draft response");
    expect(task.priority).toBe("high");
    expect(task.ownerId).toBe(userId);
  });

  test("createDeadlineFromEmail errors when the thread is unfiled", async () => {
    const unfiled = await seedEmailThread({ matterId: null });
    const res = await createDeadlineFromEmail(
      unfiled,
      inboxActionInitialState,
      deadlineForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/isn't filed/i);
    expect(await prisma.deadline.count()).toBe(0);
  });

  test("createNoteFromEmail sanitizes the body and accepts a NOTE_TYPES value", async () => {
    const res = await createNoteFromEmail(
      emailThreadId,
      inboxActionInitialState,
      noteForm({
        content: '<p>Key point</p><script>alert("x")</script>',
        type: "strategy",
      })
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({
      where: { emailThreadId },
    });
    expect(note.type).toBe("strategy");
    expect(note.content).toContain("Key point");
    expect(note.content).not.toContain("script");
  });

  test("createNoteFromEmail rejects a note that sanitizes to nothing", async () => {
    const res = await createNoteFromEmail(
      emailThreadId,
      inboxActionInitialState,
      noteForm({ content: "<p>&nbsp; </p><p></p>" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/can't be empty/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("createNoteFromEmail rejects a type outside NOTE_TYPES", async () => {
    const res = await createNoteFromEmail(
      emailThreadId,
      inboxActionInitialState,
      noteForm({ type: "diary" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.type).toBeTruthy();
  });
});

// ── Messenger item → ... ────────────────────────────────────────────────

describe("messenger promotions", () => {
  test("createDeadlineFromMessage files to the item's own matter with the source FK", async () => {
    const res = await createDeadlineFromMessage(
      messengerItemId,
      inboxActionInitialState,
      deadlineForm()
    );
    expect(res.status).toBe("ok");
    const row = await prisma.deadline.findFirstOrThrow({
      where: { messengerItemId },
    });
    expect(row.matterId).toBe(matterId);
    expect(row.dueDate.toISOString()).toMatch(/^2026-08-01/);
  });

  test("matter resolution falls back to the thread's defaultMatterId for unfiled items", async () => {
    const { itemId } = await seedMessengerItem({
      itemMatterId: null,
      defaultMatterId: matterId,
    });
    const res = await createTaskFromMessage(
      itemId,
      inboxActionInitialState,
      taskForm()
    );
    expect(res.status).toBe("ok");
    const task = await prisma.task.findFirstOrThrow({
      where: { messengerItemId: itemId },
    });
    expect(task.matterId).toBe(matterId);
  });

  test("errors when neither the item nor its thread resolves a matter", async () => {
    const { itemId } = await seedMessengerItem({
      itemMatterId: null,
      defaultMatterId: null,
    });
    const res = await createNoteFromMessage(
      itemId,
      inboxActionInitialState,
      noteForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.content?.[0]).toMatch(/isn't filed/i);
    expect(await prisma.note.count()).toBe(0);
  });

  test("createNoteFromMessage marks the note read for its author", async () => {
    const res = await createNoteFromMessage(
      messengerItemId,
      inboxActionInitialState,
      noteForm()
    );
    expect(res.status).toBe("ok");
    const note = await prisma.note.findFirstOrThrow({
      where: { messengerItemId },
      include: { reads: true },
    });
    expect(note.reads.map((r) => r.userId)).toContain(userId);
  });
});
