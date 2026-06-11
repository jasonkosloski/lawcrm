/**
 * Integration tests for the manual call-logging action.
 *
 * Covers:
 *   - zod validation (missing contact, bad duration)
 *   - no-phone-on-file error path
 *   - happy path: bootstrap manual MessengerAccount → thread → item,
 *     field mapping (direction, outcome, duration, summary, matter)
 *   - phone normalization into E.164 thread keys
 *   - thread reuse + lastItemAt advance/no-regress + contactId backfill
 *   - missed calls get callDurationSec 0 regardless of duration input
 *   - activity log fan-out (type "call") when filed to a matter
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
import { logCall } from "@/app/actions/calls";
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
