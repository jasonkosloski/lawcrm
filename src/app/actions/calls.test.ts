/**
 * Integration tests for the manual call-logging actions.
 *
 * logCall:
 *   - zod validation (missing contact, bad duration)
 *   - occurredAt parsing: malformed → field error; date-only pins to
 *     local midnight (parseLocalDateOrDateTime, no UTC-midnight drift)
 *   - no-phone-on-file error path
 *   - happy path: bootstrap manual MessengerAccount → thread → item,
 *     field mapping (direction, outcome, duration, summary, matter)
 *   - phone normalization into E.164 thread keys
 *   - thread reuse + lastItemAt advance/no-regress + contactId backfill
 *   - missed calls get callDurationSec 0 regardless of duration input
 *   - activity log fan-out (type "call") when filed to a matter
 *
 * updateCallLog / deleteCallLog:
 *   - the manual-only mutability gate (provider-synced items refused)
 *   - field re-mapping incl. from/to endpoint swap on direction flip
 *   - thread lastItemAt recompute (edit moves occurredAt either way;
 *     delete must never leave it pointing at the deleted item)
 *   - empty-thread cleanup when the last item is deleted
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

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { deleteCallLog, logCall, updateCallLog } from "@/app/actions/calls";
import { callLogInitialState } from "@/lib/call-log-form";
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
let contactId: string;

function callForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    contactId,
    phone: "",
    direction: "outbound",
    outcome: "answered",
    occurredAt: "2026-06-10T14:30",
    durationMin: "5",
    matterId: "",
    summary: "Discussed discovery schedule",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
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
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
  const contact = await prisma.contact.create({
    data: {
      name: "Maria Alvarez",
      type: "client",
      phone: "(303) 555-0182",
    },
    select: { id: true },
  });
  contactId = contact.id;
});

describe("validation", () => {
  test("rejects a missing contact", async () => {
    const res = await logCall(callLogInitialState, callForm({ contactId: "" }));
    expect(res.status).toBe("error");
    expect(res.errors?.contactId).toBeTruthy();
  });

  test("rejects a non-numeric duration", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ durationMin: "5.5h" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.durationMin).toBeTruthy();
  });

  test("errors usefully when the contact has no phone and none was entered", async () => {
    const bare = await prisma.contact.create({
      data: { name: "No Phone", type: "witness" },
      select: { id: true },
    });
    const res = await logCall(
      callLogInitialState,
      callForm({ contactId: bare.id })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phone?.[0]).toMatch(/no phone/i);
  });

  test("rejects an unknown matter", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ matterId: "nope" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.matterId).toBeTruthy();
  });

  test("rejects a malformed occurredAt with a field error", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "not-a-date" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.occurredAt).toBeTruthy();
  });

  test("date-only occurredAt parses to local midnight, not UTC midnight", async () => {
    // A tampered/stale POST can drop the time half of the
    // datetime-local value. `new Date("2026-06-10")` reads it as UTC
    // midnight — a day early for any runtime west of UTC.
    // parseLocalDateOrDateTime pins it to local midnight instead.
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-10" })
    );
    expect(res.status).toBe("ok");
    const item = await prisma.messengerItem.findFirst({
      select: { occurredAt: true },
    });
    expect(item?.occurredAt).toEqual(new Date(2026, 5, 10, 0, 0, 0, 0));
  });
});

describe("happy path", () => {
  test("bootstraps a manual account, thread, and call item", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ matterId })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("communication.log_call");

    const account = await prisma.messengerAccount.findFirstOrThrow();
    expect(account.provider).toBe("manual");

    const thread = await prisma.messengerThread.findFirstOrThrow({
      include: { items: true },
    });
    // Normalized from "(303) 555-0182".
    expect(thread.contactPhone).toBe("+13035550182");
    expect(thread.contactId).toBe(contactId);
    expect(thread.defaultMatterId).toBe(matterId);
    expect(thread.lastItemAt).toEqual(new Date("2026-06-10T14:30"));
    // A self-logged call never counts as unread.
    expect(thread.unreadCount).toBe(0);

    expect(thread.items).toHaveLength(1);
    const item = thread.items[0];
    expect(item.kind).toBe("call");
    expect(item.direction).toBe("outbound");
    expect(item.callStatus).toBe("answered");
    expect(item.callDurationSec).toBe(300);
    expect(item.body).toBe("Discussed discovery schedule");
    expect(item.matterId).toBe(matterId);
    expect(item.isRead).toBe(true);
    expect(item.providerEventId).toMatch(/^manual-/);
    // Outbound: firm number → contact.
    expect(item.toNumber).toBe("+13035550182");

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { type: "call" },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.userId).toBe(userId);
    expect(activity.title).toContain("Maria Alvarez");
    expect(activity.detail).toContain("5m");

    // Matter surfaces refresh — including the Communication tab's
    // Phone channel.
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });

  test("missed calls store zero duration even when minutes were entered", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ outcome: "missed", durationMin: "10", direction: "inbound" })
    );
    expect(res.status).toBe("ok");
    const item = await prisma.messengerItem.findFirstOrThrow();
    expect(item.callStatus).toBe("missed");
    expect(item.callDurationSec).toBe(0);
    // Inbound: contact → firm number.
    expect(item.fromNumber).toBe("+13035550182");
  });

  test("a typed phone overrides the contact's number on file", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ phone: "720-555-0000" })
    );
    expect(res.status).toBe("ok");
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.contactPhone).toBe("+17205550000");
  });
});

/** FormData for updateCallLog — same field names as the composer's
 *  edit mode. */
function updateForm(
  itemId: string,
  overrides: Record<string, string> = {}
): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    itemId,
    direction: "outbound",
    outcome: "answered",
    occurredAt: "2026-06-10T14:30",
    durationMin: "5",
    matterId: "",
    summary: "Discussed discovery schedule",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

/** Seed a provider-synced (immutable) call item + its thread, the
 *  way the future webhook handler would. */
async function seedProviderCall() {
  const account = await prisma.messengerAccount.create({
    data: { provider: "quo", phoneNumber: "+13035550100" },
  });
  const thread = await prisma.messengerThread.create({
    data: {
      accountId: account.id,
      contactPhone: "+13035550182",
      lastItemAt: new Date("2026-06-01T10:00"),
    },
  });
  const item = await prisma.messengerItem.create({
    data: {
      threadId: thread.id,
      providerEventId: "quo-evt-1",
      kind: "call",
      direction: "inbound",
      fromNumber: "+13035550182",
      toNumber: "+13035550100",
      callStatus: "answered",
      callDurationSec: 120,
      occurredAt: new Date("2026-06-01T10:00"),
    },
  });
  return { threadId: thread.id, itemId: item.id };
}

describe("updateCallLog", () => {
  test("edits fields, swaps endpoints on direction flip, and logs activity", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    expect(item.direction).toBe("outbound");

    const res = await updateCallLog(
      callLogInitialState,
      updateForm(item.id, {
        direction: "inbound",
        outcome: "answered",
        durationMin: "12",
        matterId,
        summary: "Corrected: they called us",
      })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("communication.edit_call");

    const updated = await prisma.messengerItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(updated.direction).toBe("inbound");
    // Endpoints swapped with the direction: contact is now the caller.
    expect(updated.fromNumber).toBe(item.toNumber);
    expect(updated.toNumber).toBe(item.fromNumber);
    expect(updated.callDurationSec).toBe(12 * 60);
    expect(updated.body).toBe("Corrected: they called us");
    expect(updated.matterId).toBe(matterId);
    // Identity fields untouched.
    expect(updated.providerEventId).toBe(item.providerEventId);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Updated a logged call" } },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.title).toContain("Maria Alvarez");

    // Both the inbox and the newly-filed matter surfaces refresh.
    expect(revalidatePath).toHaveBeenCalledWith("/communication");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });

  test("changing outcome to missed zeroes the duration", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();

    const res = await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { outcome: "missed", durationMin: "10" })
    );
    expect(res.status).toBe("ok");
    const updated = await prisma.messengerItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(updated.callStatus).toBe("missed");
    expect(updated.callDurationSec).toBe(0);
  });

  test("recomputes lastItemAt when the newest call is edited earlier", async () => {
    await logCall(callLogInitialState, callForm()); // 06-10 14:30
    await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-11T09:00" })
    );
    const late = await prisma.messengerItem.findFirstOrThrow({
      where: { occurredAt: new Date("2026-06-11T09:00") },
    });

    // Move the 06-11 call back to 06-05 — the thread's sort key must
    // fall back to the remaining newest item (06-10), not stay stale.
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(late.id, { occurredAt: "2026-06-05T08:00" })
    );
    expect(res.status).toBe("ok");
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(new Date("2026-06-10T14:30"));
  });

  test("advances lastItemAt when the edit moves a call forward", async () => {
    await logCall(callLogInitialState, callForm()); // 06-10 14:30
    const item = await prisma.messengerItem.findFirstOrThrow();

    await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { occurredAt: "2026-06-20T16:00" })
    );
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(new Date("2026-06-20T16:00"));
  });

  test("refuses provider-synced items — they are immutable records", async () => {
    const { itemId } = await seedProviderCall();
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(itemId, { summary: "tamper attempt" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.form?.[0]).toMatch(/manually logged/i);

    const item = await prisma.messengerItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(item.callDurationSec).toBe(120);
    expect(item.body).toBeNull();
  });

  test("rejects an unknown matter", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { matterId: "nope" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.matterId).toBeTruthy();
  });

  test("errors cleanly on a vanished item", async () => {
    const res = await updateCallLog(
      callLogInitialState,
      updateForm("gone")
    );
    expect(res.status).toBe("error");
    expect(res.errors?.form?.[0]).toMatch(/not found/i);
  });
});

describe("deleteCallLog", () => {
  test("deletes and recomputes lastItemAt from the survivors", async () => {
    await logCall(callLogInitialState, callForm()); // 06-10 14:30
    await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-11T09:00" })
    );
    const late = await prisma.messengerItem.findFirstOrThrow({
      where: { occurredAt: new Date("2026-06-11T09:00") },
    });

    const res = await deleteCallLog(late.id);
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith(
      "communication.delete_call"
    );

    expect(
      await prisma.messengerItem.findUnique({ where: { id: late.id } })
    ).toBeNull();
    // lastItemAt no longer points at the deleted item.
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(new Date("2026-06-10T14:30"));

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Deleted a logged call" } },
    });
    expect(activity.title).toContain("Maria Alvarez");
    expect(revalidatePath).toHaveBeenCalledWith("/communication");
  });

  test("deleting the thread's only item deletes the (now empty) thread", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();

    const res = await deleteCallLog(item.id);
    expect(res.ok).toBe(true);
    // Threads are keyed by (account, phone) and re-created on demand,
    // so no empty shell lingers in the inbox.
    expect(await prisma.messengerThread.count()).toBe(0);
    // The owning account survives for the next log.
    expect(await prisma.messengerAccount.count()).toBe(1);
  });

  test("detaches (not deletes) time entries logged on the call", async () => {
    await logCall(callLogInitialState, callForm({ matterId }));
    const item = await prisma.messengerItem.findFirstOrThrow();
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date("2026-06-10"),
        hours: 0.3,
        activity: "Client call",
        messengerItemId: item.id,
      },
      select: { id: true },
    });

    const res = await deleteCallLog(item.id);
    expect(res.ok).toBe(true);
    const survivor = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(survivor.messengerItemId).toBeNull();
  });

  test("refuses provider-synced items — they are immutable records", async () => {
    const { itemId, threadId } = await seedProviderCall();
    const res = await deleteCallLog(itemId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/manually logged/i);
    expect(
      await prisma.messengerItem.findUnique({ where: { id: itemId } })
    ).not.toBeNull();
    expect(
      await prisma.messengerThread.findUnique({ where: { id: threadId } })
    ).not.toBeNull();
  });

  test("errors cleanly on a vanished item", async () => {
    const res = await deleteCallLog("gone");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("thread reuse", () => {
  test("second call to the same number reuses the thread and advances lastItemAt", async () => {
    await logCall(callLogInitialState, callForm());
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-11T09:00", summary: "Follow-up" })
    );
    expect(res.status).toBe("ok");

    const threads = await prisma.messengerThread.findMany({
      include: { items: true },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].items).toHaveLength(2);
    expect(threads[0].lastItemAt).toEqual(new Date("2026-06-11T09:00"));
  });

  test("logging an older call does not regress lastItemAt", async () => {
    await logCall(callLogInitialState, callForm());
    await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-01T08:00" })
    );
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(new Date("2026-06-10T14:30"));
  });

  test("backfills contactId on a thread that lacked one", async () => {
    // Simulate a webhook-created thread for an unrecognized number.
    const account = await prisma.messengerAccount.create({
      data: { provider: "quo", phoneNumber: "+13035550100" },
    });
    const orphan = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550182",
        lastItemAt: new Date("2026-06-01T00:00"),
      },
    });

    const res = await logCall(callLogInitialState, callForm());
    expect(res.status).toBe("ok");

    const thread = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: orphan.id },
    });
    expect(thread.contactId).toBe(contactId);
    // Reused the existing active account — no manual account created.
    expect(await prisma.messengerAccount.count()).toBe(1);
  });
});
