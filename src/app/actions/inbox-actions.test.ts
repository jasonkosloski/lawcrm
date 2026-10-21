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
    expect(res.errors?.title?.[0]).toMatch(/needs a thread filed to a matter/i);
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
    expect(row.dueDate).toEqual(new Date("2026-08-01T00:00:00.000Z"));
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

// ── Email promotions: mailbox ownership ─────────────────────────────────

describe("email promotions — mailbox ownership", () => {
  /** A filed thread in ANOTHER user's mailbox. */
  async function seedForeignFiledThread(): Promise<string> {
    const { firmId } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firmId: true },
    });
    const { userId: ownerId } = await seedUser({ firmId: firmId as string });
    const account = await prisma.emailAccount.create({
      data: { userId: ownerId, emailAddress: `owner-${next()}@lawcrm.test` },
      select: { id: true },
    });
    const thread = await prisma.emailThread.create({
      data: {
        accountId: account.id,
        matterId,
        subject: "Privileged: settlement authority",
        lastMessageAt: new Date("2026-06-01T10:00:00Z"),
      },
      select: { id: true },
    });
    return thread.id;
  }

  test("a non-owner cannot spawn a task, deadline or note from a colleague's thread", async () => {
    const foreign = await seedForeignFiledThread();

    const task = await createTaskFromEmail(
      foreign,
      inboxActionInitialState,
      taskForm()
    );
    const deadline = await createDeadlineFromEmail(
      foreign,
      inboxActionInitialState,
      deadlineForm()
    );
    const note = await createNoteFromEmail(
      foreign,
      inboxActionInitialState,
      noteForm()
    );

    expect(task.status).toBe("error");
    expect(deadline.status).toBe("error");
    expect(note.status).toBe("error");
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.deadline.count()).toBe(0);
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.activityLog.count()).toBe(0);
  });
});

describe("email promotions — owner succeeds (pairs with the non-owner case)", () => {
  test("the mailbox owner can spawn a task, deadline and note from their own filed thread", async () => {
    const task = await createTaskFromEmail(
      emailThreadId,
      inboxActionInitialState,
      taskForm()
    );
    const deadline = await createDeadlineFromEmail(
      emailThreadId,
      inboxActionInitialState,
      deadlineForm()
    );
    const note = await createNoteFromEmail(
      emailThreadId,
      inboxActionInitialState,
      noteForm()
    );
    expect(task.status).toBe("ok");
    expect(deadline.status).toBe("ok");
    expect(note.status).toBe("ok");
    expect(await prisma.task.count({ where: { emailThreadId } })).toBe(1);
    expect(await prisma.deadline.count({ where: { emailThreadId } })).toBe(1);
    expect(await prisma.note.count({ where: { emailThreadId } })).toBe(1);
  });
});

describe("date-only due dates are zone-independent (ADR-012)", () => {
  test("a deadline due 2026-08-01 is stored at UTC midnight whatever the server zone", async () => {
    await createDeadlineFromEmail(
      emailThreadId,
      inboxActionInitialState,
      deadlineForm({ dueDate: "2026-08-01" })
    );
    const row = await prisma.deadline.findFirstOrThrow({
      where: { emailThreadId },
    });
    expect(row.dueDate).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  test("a task due date is stored at UTC midnight and an impossible date is a field error", async () => {
    await createTaskFromEmail(
      emailThreadId,
      inboxActionInitialState,
      taskForm({ dueDate: "2026-04-15" })
    );
    const row = await prisma.task.findFirstOrThrow({ where: { emailThreadId } });
    expect(row.dueDate).toEqual(new Date("2026-04-15T00:00:00.000Z"));

    const bad = await createTaskFromEmail(
      emailThreadId,
      inboxActionInitialState,
      taskForm({ dueDate: "2026-02-30" })
    );
    expect(bad.status).toBe("error");
    expect(bad.errors?.dueDate).toBeTruthy();
  });
});

describe("note promotions (F666 / F667)", () => {
  test("the activity preview shows decoded text, not HTML entities", async () => {
    await createNoteFromEmail(
      emailThreadId,
      inboxActionInitialState,
      noteForm({ content: '<p>Smith &amp; Jones said "no" &lt;today&gt;</p>' })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Note saved from email" },
    });
    expect(log.detail).toBe('Smith & Jones said "no" <today>');
  });

  test("the message variant decodes the preview too", async () => {
    await createNoteFromMessage(
      messengerItemId,
      inboxActionInitialState,
      noteForm({ content: "<p>AT&amp;T called</p>" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Note saved from message" },
    });
    expect(log.detail).toBe("AT&T called");
  });

  test("the note and its author read marker commit together - a failed marker leaves no note", async () => {
    const original = prisma.$transaction.bind(prisma) as (
      fn: (tx: unknown) => Promise<unknown>
    ) => Promise<unknown>;
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
        original((tx) =>
          fn(
            new Proxy(tx as object, {
              get(target, prop) {
                if (prop === "noteRead") {
                  return {
                    create: () => Promise.reject(new Error("connection lost")),
                  };
                }
                return (target as Record<string | symbol, unknown>)[prop];
              },
            })
          )
        )) as never);

    await expect(
      createNoteFromEmail(emailThreadId, inboxActionInitialState, noteForm())
    ).rejects.toThrow("connection lost");
    spy.mockRestore();

    expect(await prisma.note.count()).toBe(0);
  });
});
