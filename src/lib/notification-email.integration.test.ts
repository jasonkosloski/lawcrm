/**
 * Integration tests for the notification email worker
 * (`runNotificationEmailDelivery`): the outbox drain, per-category
 * modes, matter mute, the deadline guard, send-time access checks,
 * retries, and the once-a-day digest at 07:00 local.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { __setDriverForTests } from "@/lib/email/send";
import { captureEmails } from "@/test/email-capture";
import { runNotificationEmailDelivery } from "@/lib/notification-email";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

// America/Denver is UTC-6 on these dates (MDT).
const AT_0730_DENVER = new Date("2026-10-21T13:30:00Z");
const AT_0630_DENVER = new Date("2026-10-21T12:30:00Z");
const NEXT_DAY_0730 = new Date("2026-10-22T13:30:00Z");
/** Rows default to the night before, so they precede the 07:00 cutoff. */
const OVERNIGHT = new Date("2026-10-21T05:00:00Z");

/** Unpaced runs keep the suite fast; pacing has its own test. */
const run = (now: Date) =>
  runNotificationEmailDelivery(now, { minSendIntervalMs: 0 });

let firmId: string;
let userId: string;
let matterId: string;
let mail: ReturnType<typeof captureEmails>;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  process.env.STAFF_ORIGINS = "https://app.test";
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId, email: "atty@example.com" }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
  mail = captureEmails();
});

afterEach(() => mail.restore());

function notify(over: {
  type?: string;
  title?: string;
  matterId?: string | null;
  readAt?: Date | null;
  emailState?: string;
  user?: string;
  createdAt?: Date;
} = {}) {
  return prisma.notification.create({
    data: {
      userId: over.user ?? userId,
      type: over.type ?? "task_assigned",
      title: over.title ?? "Task assigned",
      link: "/tasks",
      matterId: over.matterId === undefined ? matterId : over.matterId,
      readAt: over.readAt ?? null,
      createdAt: over.createdAt ?? OVERNIGHT,
      ...(over.emailState ? { emailState: over.emailState } : {}),
    },
    select: { id: true },
  });
}

const stateOf = async (id: string) =>
  (await prisma.notification.findUniqueOrThrow({ where: { id } })).emailState;

const setMode = (category: string, emailMode: string) =>
  prisma.notificationPreference.create({
    data: { userId, category, emailMode },
  });

describe("instant delivery", () => {
  test("sends instant and stamps sent", async () => {
    const { id } = await notify();
    const res = await run(AT_0730_DENVER);
    expect(res.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("atty@example.com");
    expect(mail.sent[0].subject).toBe("Task assigned");
    const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(row.emailState).toBe("sent");
    expect(row.emailedAt).not.toBeNull();
  });

  test("no preference rows means instant", async () => {
    await notify({ type: "portal_message", title: "Client wrote" });
    await notify({ type: "invoice_payment_recorded", title: "Paid" });
    await run(AT_0730_DENVER);
    expect(mail.sent.map((m) => m.subject).sort()).toEqual([
      "Client wrote",
      "Paid",
    ]);
  });

  test("off skips", async () => {
    await setMode("tasks", "off");
    const { id } = await notify();
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("deadline off is coerced to instant", async () => {
    await setMode("deadlines", "off");
    const { id } = await notify({ type: "deadline_approaching" });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(1);
    expect(await stateOf(id)).toBe("sent");
  });

  test("matter mute skips tasks but not deadlines", async () => {
    await prisma.notificationMatterMute.create({ data: { userId, matterId } });
    const task = await notify();
    const deadline = await notify({ type: "deadline_overdue" });
    const unscoped = await notify({ matterId: null, title: "No matter" });
    await run(AT_0730_DENVER);
    expect(await stateOf(task.id)).toBe("skipped");
    expect(await stateOf(deadline.id)).toBe("sent");
    expect(await stateOf(unscoped.id)).toBe("sent");
  });

  test("skips a row already read", async () => {
    const { id } = await notify({ readAt: new Date() });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("skips inactive user", async () => {
    const { userId: gone } = await seedUser({ firmId, isActive: false });
    const { id } = await notify({ user: gone });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("skips when matter access lost", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: { matterVisibility: "TEAM" },
    });
    const { userId: outsider } = await seedUser({ firmId });
    const { id } = await notify({ user: outsider });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("skipped rows are never picked up", async () => {
    const { id } = await notify({ emailState: "skipped" });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("retries then fails", async () => {
    __setDriverForTests(async () => ({ ok: false, error: "down" }));
    const { id } = await notify();
    for (let i = 0; i < 3; i++) await run(AT_0730_DENVER);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(row.emailAttempts).toBe(3);
    expect(row.emailState).toBe("failed");
    // A failed row is not retried again.
    await run(AT_0730_DENVER);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id } })).emailAttempts
    ).toBe(3);
  });

  test("concurrent runs send once", async () => {
    await notify();
    await Promise.all([
      run(AT_0730_DENVER),
      run(AT_0730_DENVER),
    ]);
    expect(mail.sent).toHaveLength(1);
  });
});

describe("daily digest", () => {
  beforeEach(async () => {
    await setMode("tasks", "digest");
  });

  test("digest holds before 07:00 local", async () => {
    const { id } = await notify();
    const res = await run(AT_0630_DENVER);
    expect(res.held).toBe(1);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("held");
  });

  test("digest sends once per day", async () => {
    const a = await notify({ title: "First task" });
    const b = await notify({ title: "Second task" });
    await run(AT_0630_DENVER);
    const res = await run(AT_0730_DENVER);
    expect(res.digests).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Your daily summary: 2 notifications");
    expect(mail.sent[0].text).toContain("First task");
    expect(mail.sent[0].text).toContain("Second task");
    expect(await stateOf(a.id)).toBe("sent");
    expect(await stateOf(b.id)).toBe("sent");

    const later = await notify({
      title: "Later task",
      createdAt: new Date("2026-10-21T14:00:00Z"),
    });
    await run(
      new Date(AT_0730_DENVER.getTime() + 60 * 60 * 1000)
    );
    expect(mail.sent).toHaveLength(1);
    expect(await stateOf(later.id)).toBe("held");

    await run(NEXT_DAY_0730);
    expect(mail.sent).toHaveLength(2);
    expect(await stateOf(later.id)).toBe("sent");
  });

  test("digest re-decides held rows", async () => {
    const { id } = await notify();
    await run(AT_0630_DENVER);
    await prisma.notificationPreference.update({
      where: { userId_category: { userId, category: "tasks" } },
      data: { emailMode: "off" },
    });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(id)).toBe("skipped");
  });

  test("digest failure leaves rows held and retries", async () => {
    const { id } = await notify();
    __setDriverForTests(async () => ({ ok: false, error: "down" }));
    await run(AT_0730_DENVER);
    expect(await stateOf(id)).toBe("held");
    mail = captureEmails();
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(1);
    expect(await stateOf(id)).toBe("sent");
  });

  test("digest gives up after repeated failures", async () => {
    const { id } = await notify();
    __setDriverForTests(async () => ({ ok: false, error: "suppressed" }));
    for (let i = 0; i < 4; i++) await run(AT_0730_DENVER);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(row.emailAttempts).toBe(3);
    expect(row.emailState).toBe("failed");
  });

  test("digest covers only rows from before 07:00", async () => {
    // Quiet morning: nothing held at 07:00, a task arrives at 10:12.
    const late = await notify({ createdAt: new Date("2026-10-21T16:12:00Z") });
    await run(new Date("2026-10-21T16:15:00Z"));
    expect(mail.sent).toHaveLength(0);
    expect(await stateOf(late.id)).toBe("held");
    await run(NEXT_DAY_0730);
    expect(mail.sent).toHaveLength(1);
    expect(await stateOf(late.id)).toBe("sent");
  });

  test("held rows do not starve instant rows", async () => {
    await prisma.notification.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({
        userId,
        type: "task_assigned",
        title: `Held ${i}`,
        createdAt: new Date(OVERNIGHT.getTime() - (i + 1) * 1000),
      })),
    });
    const { userId: other } = await seedUser({ firmId, email: "other@example.com" });
    await notify({ user: other, matterId: null, title: "Instant for other" });
    // 06:30: nobody's digest is due, so only the instant pass can send.
    // The backlog drains a batch per run; old code never got past it.
    for (let i = 0; i < 6; i++) await run(AT_0630_DENVER);
    expect(mail.sent.map((m) => m.subject)).toEqual(["Instant for other"]);
  });
});

describe("delivery safety", () => {
  test("each send is committed before the next send starts", async () => {
    const a = await notify({ title: "First" });
    await notify({ title: "Second", createdAt: new Date(OVERNIGHT.getTime() + 1000) });
    const seen: string[] = [];
    __setDriverForTests(async (msg) => {
      mail.sent.push(msg);
      if (msg.subject === "Second") {
        // A separate connection must already see the first stamp.
        seen.push(await stateOf(a.id));
      }
      return { ok: true };
    });
    await run(AT_0730_DENVER);
    expect(seen).toEqual(["sent"]);
  });

  test("a run that hits its time budget leaves the rest for the next run", async () => {
    for (let i = 0; i < 3; i++) {
      await notify({ title: `Row ${i}`, createdAt: new Date(OVERNIGHT.getTime() + i * 1000) });
    }
    const first = await runNotificationEmailDelivery(AT_0730_DENVER, {
      minSendIntervalMs: 0,
      budgetMs: 0,
    });
    expect(first.sent).toBe(1);
    expect(await prisma.notification.count({ where: { emailState: "pending" } })).toBe(2);
    await run(AT_0730_DENVER);
    expect(mail.sent.map((m) => m.subject)).toEqual(["Row 0", "Row 1", "Row 2"]);
  });

  test("a claim abandoned by a crashed run is reclaimed later", async () => {
    const { id } = await notify();
    await prisma.notification.update({
      where: { id },
      data: { emailState: "sending", emailClaimedAt: new Date(AT_0730_DENVER.getTime() - 60_000) },
    });
    await run(AT_0730_DENVER);
    expect(mail.sent).toHaveLength(0);
    await run(new Date(AT_0730_DENVER.getTime() + 15 * 60_000));
    expect(mail.sent).toHaveLength(1);
    expect(await stateOf(id)).toBe("sent");
  });

  test("paces consecutive sends", async () => {
    await notify({ title: "One" });
    await notify({ title: "Two", createdAt: new Date(OVERNIGHT.getTime() + 1000) });
    const started = Date.now();
    await runNotificationEmailDelivery(AT_0730_DENVER, { minSendIntervalMs: 120 });
    expect(mail.sent).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);
  });
});
