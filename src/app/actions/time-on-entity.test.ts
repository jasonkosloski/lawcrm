/**
 * Integration tests for the entity-scoped "log time on this X"
 * actions (task / deadline / email message / messenger item).
 *
 * Covers:
 *   - RBAC gate: all four actions hit `time_entries.create` — the
 *     same key as the sibling create paths in time-entries.ts and
 *     captures.ts — and the gate fires BEFORE any row is written,
 *     so a denied user can't log time through these side doors.
 *   - Happy path: gate passes → entry lands with the parent FK set.
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
  addTimeEntryToDeadline,
  addTimeEntryToEmailMessage,
  addTimeEntryToMessengerItem,
  addTimeEntryToTask,
} from "@/app/actions/time-on-entity";
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
  const u = await seedUser({ firmId, email: "logger@example.com" });
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

const buildTimeForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("date", overrides.date ?? "2026-04-01");
  fd.set("hours", overrides.hours ?? "0.5");
  fd.set("activity", overrides.activity ?? "Reviewing");
  fd.set("narrative", overrides.narrative ?? "");
  if (overrides.privileged) fd.set("privileged", overrides.privileged);
  return fd;
};

const seedTask = async () => {
  const t = await prisma.task.create({
    data: { matterId, title: "Draft motion", status: "open" },
    select: { id: true },
  });
  return t.id;
};


/** Every activity row's text, serialized — for "never leaked" checks. */
const activityText = async () =>
  JSON.stringify(await prisma.activityLog.findMany());

const SECRET = "Strategy re: confidential settlement posture";

// ── RBAC gates ──────────────────────────────────────────────────────────

describe("time-on-entity action gates", () => {
  // Bogus parent ids are fine here: the gate must fire before the
  // parent lookup, so the permission call is observable either way.
  test("addTimeEntryToTask gates on time_entries.create", async () => {
    await addTimeEntryToTask("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToDeadline gates on time_entries.create", async () => {
    await addTimeEntryToDeadline("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToEmailMessage gates on time_entries.create", async () => {
    await addTimeEntryToEmailMessage("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("addTimeEntryToMessengerItem gates on time_entries.create", async () => {
    await addTimeEntryToMessengerItem("nope", noteAttachmentInitialState, buildTimeForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("time_entries.create");
  });

  test("denied permission blocks the write entirely", async () => {
    const taskId = await seedTask();
    // requirePermission redirects (throws) on denial — simulate that.
    mockedRequirePermission.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      addTimeEntryToTask(taskId, noteAttachmentInitialState, buildTimeForm())
    ).rejects.toThrow();
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

// ── Happy path ──────────────────────────────────────────────────────────

describe("addTimeEntryToTask — creation", () => {
  test("creates the entry with the task FK when the gate passes", async () => {
    const taskId = await seedTask();
    const res = await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ hours: "1.5", activity: "Drafting" })
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirstOrThrow({
      select: { taskId: true, matterId: true, userId: true, source: true },
    });
    expect(entry.taskId).toBe(taskId);
    expect(entry.matterId).toBe(matterId);
    expect(entry.userId).toBe(userId);
    expect(entry.source).toBe("task");
  });
});

// ── Email message: mailbox ownership ────────────────────────────────────

describe("addTimeEntryToEmailMessage — mailbox ownership", () => {
  /** A message in `ownerId`'s mailbox, thread filed to the test matter. */
  async function seedMessage(ownerId: string) {
    const account = await prisma.emailAccount.create({
      data: { userId: ownerId, emailAddress: `box-${ownerId}@example.com` },
      select: { id: true },
    });
    const thread = await prisma.emailThread.create({
      data: {
        accountId: account.id,
        matterId,
        subject: "Privileged: settlement authority",
        lastMessageAt: new Date("2026-06-10T14:30:00Z"),
        messages: {
          create: {
            fromName: "Client C.",
            fromEmail: "c@client.test",
            toRecipients: "[]",
            body: "secret body",
            sentAt: new Date("2026-06-10T14:30:00Z"),
          },
        },
      },
      select: { messages: { select: { id: true } } },
    });
    return thread.messages[0].id;
  }

  test("the mailbox owner can log time on their own message", async () => {
    const messageId = await seedMessage(userId);
    const res = await addTimeEntryToEmailMessage(
      messageId,
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirstOrThrow({
      select: { emailMessageId: true, userId: true, source: true },
    });
    expect(entry).toEqual({
      emailMessageId: messageId,
      userId,
      source: "email",
    });
  });

  test("privileged=on logs no detail (no activity, subject or sender)", async () => {
    const messageId = await seedMessage(userId);
    const res = await addTimeEntryToEmailMessage(
      messageId,
      noteAttachmentInitialState,
      buildTimeForm({ activity: SECRET, privileged: "on" })
    );
    expect(res.status).toBe("ok");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "time_entry" },
    });
    expect(log.detail).toBeNull();
    const text = await activityText();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("settlement authority");
  });

  test("another user cannot log time on a colleague's private message", async () => {
    const { firmId } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firmId: true },
    });
    const { userId: ownerId } = await seedUser({ firmId: firmId as string });
    const messageId = await seedMessage(ownerId);

    // userId (the mocked actor) does not own this mailbox.
    const res = await addTimeEntryToEmailMessage(
      messageId,
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(await prisma.timeEntry.count()).toBe(0);
    // Nothing about the victim's email reaches the activity log.
    const logs = JSON.stringify(await prisma.activityLog.findMany());
    expect(logs).not.toContain("settlement authority");
    expect(logs).not.toContain("Client C.");
  });
});

// ── Date-only handling (ADR-012) ────────────────────────────────────────

describe("time-on-entity — date-only input", () => {
  test("the posted day is stored as UTC midnight (no zone drift)", async () => {
    const taskId = await seedTask();
    await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ date: "2026-04-01" })
    );
    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry.date.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  test("an impossible calendar date is a field error and writes nothing", async () => {
    const taskId = await seedTask();
    const res = await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ date: "2026-02-31" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.date).toBeTruthy();
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("shared hours bound still applies (> 24 rejected)", async () => {
    const taskId = await seedTask();
    const res = await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ hours: "25" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.hours?.[0]).toMatch(/> 0 and ≤ 24/);
  });
});

// ── Remaining parents: happy and error paths ────────────────────────────

describe("privileged entries stay out of the activity feed", () => {
  test("task: privileged=on logs no detail; off keeps it", async () => {
    const taskId = await seedTask();
    await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ activity: SECRET, privileged: "on" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "time_entry" },
    });
    expect(log.detail).toBeNull();
    expect(await activityText()).not.toContain(SECRET);
    expect(await prisma.timeEntry.count({ where: { privileged: true } })).toBe(1);

    await prisma.activityLog.deleteMany();
    await addTimeEntryToTask(
      taskId,
      noteAttachmentInitialState,
      buildTimeForm({ activity: SECRET })
    );
    expect(await activityText()).toContain(SECRET);
  });

  test("deadline: privileged=on logs no detail", async () => {
    const deadline = await prisma.deadline.create({
      data: { matterId, title: "Answer due", dueDate: new Date("2026-05-01T00:00:00Z") },
      select: { id: true },
    });
    await addTimeEntryToDeadline(
      deadline.id,
      noteAttachmentInitialState,
      buildTimeForm({ activity: SECRET, privileged: "on" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "time_entry" },
    });
    expect(log.detail).toBeNull();
    expect(await activityText()).not.toContain(SECRET);
  });
});

describe("addTimeEntryToTask — errors", () => {
  test("a missing task is a friendly error, nothing written", async () => {
    const res = await addTimeEntryToTask(
      "missing",
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/no longer exists/i);
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("addTimeEntryToDeadline", () => {
  test("creates the entry with the deadline FK and logs it under the matter", async () => {
    const deadline = await prisma.deadline.create({
      data: {
        matterId,
        title: "Answer due",
        dueDate: new Date("2026-05-01T00:00:00Z"),
      },
      select: { id: true },
    });
    const res = await addTimeEntryToDeadline(
      deadline.id,
      noteAttachmentInitialState,
      buildTimeForm({ hours: "0.75", activity: "Prep answer" })
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry).toMatchObject({
      deadlineId: deadline.id,
      matterId,
      userId,
      hours: 0.75,
      source: "manual",
    });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "time_entry" },
    });
    expect(log.matterId).toBe(matterId);
    expect(log.title).toMatch(/deadline/i);
  });

  test("a missing deadline is a friendly error", async () => {
    const res = await addTimeEntryToDeadline(
      "missing",
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/no longer exists/i);
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("addTimeEntryToEmailMessage — errors", () => {
  test("a message that doesn't exist is refused like an unfiled one", async () => {
    const res = await addTimeEntryToEmailMessage(
      "missing",
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/file the thread/i);
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("addTimeEntryToMessengerItem", () => {
  async function seedItem(opts: {
    itemMatterId?: string;
    threadMatterId?: string;
  }) {
    const account = await prisma.messengerAccount.create({
      data: { userId, phoneNumber: "+13035550100" },
      select: { id: true },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550199",
        lastItemAt: new Date("2026-06-10T14:30:00Z"),
        defaultMatterId: opts.threadMatterId ?? null,
      },
      select: { id: true },
    });
    const item = await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: `evt-${thread.id}`,
        kind: "sms",
        direction: "inbound",
        fromNumber: "+13035550199",
        toNumber: "+13035550100",
        occurredAt: new Date("2026-06-10T14:30:00Z"),
        matterId: opts.itemMatterId ?? null,
      },
      select: { id: true },
    });
    return item.id;
  }

  test("an item filed to a matter logs time on it (item matter wins)", async () => {
    const itemId = await seedItem({ itemMatterId: matterId });
    const res = await addTimeEntryToMessengerItem(
      itemId,
      noteAttachmentInitialState,
      buildTimeForm({ activity: "Text with client" })
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry).toMatchObject({
      messengerItemId: itemId,
      matterId,
      userId,
    });
  });

  test("privileged=on logs no detail", async () => {
    const itemId = await seedItem({ itemMatterId: matterId });
    const res = await addTimeEntryToMessengerItem(
      itemId,
      noteAttachmentInitialState,
      buildTimeForm({ activity: SECRET, privileged: "on" })
    );
    expect(res.status).toBe("ok");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "time_entry" },
    });
    expect(log.detail).toBeNull();
    expect(await activityText()).not.toContain(SECRET);
  });

  test("falls back to the thread's default matter", async () => {
    const itemId = await seedItem({ threadMatterId: matterId });
    const res = await addTimeEntryToMessengerItem(
      itemId,
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("ok");
    expect((await prisma.timeEntry.findFirstOrThrow()).matterId).toBe(matterId);
  });

  test("an unfiled conversation is refused, nothing written", async () => {
    const itemId = await seedItem({});
    const res = await addTimeEntryToMessengerItem(
      itemId,
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/isn't filed/i);
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("a missing item is a friendly error", async () => {
    const res = await addTimeEntryToMessengerItem(
      "missing",
      noteAttachmentInitialState,
      buildTimeForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/not found/i);
  });
});
