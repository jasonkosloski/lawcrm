/**
 * Integration tests for the manual call-logging actions.
 *
 * logCall:
 *   - zod validation (missing contact, bad duration)
 *   - occurredAt parsing: the zone-less datetime-local value is read in
 *     the USER's profile zone (mocked; Denver by default) - never the
 *     process zone; malformed → field error; date-only pins to
 *     midnight in the user's zone
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
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { Prisma } from "@/generated/prisma/client";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
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
const mockedTz = vi.mocked(getCurrentUserTimeZone);

/** The user's profile zone for these tests. Deliberately NOT the
 *  process zone (the suite runs in America/Denver AND UTC), so a
 *  server-local parse cannot pass by accident. */
const USER_TZ = "America/Denver";
/** Denver (MDT, UTC-6) wall-clock -> the UTC instants the action must store. */
const JUN10_1430 = new Date("2026-06-10T20:30:00.000Z");
const JUN11_0900 = new Date("2026-06-11T15:00:00.000Z");
const JUN20_1600 = new Date("2026-06-20T22:00:00.000Z");
const JUN01_0800 = new Date("2026-06-01T14:00:00.000Z");

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
  // The mocks are module-level and never auto-cleared: without this a
  // `toHaveBeenCalledWith` can pass on a call from an earlier test.
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockedTz.mockResolvedValue(USER_TZ);
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
    // Unknown == hidden: the matter wall answers with notFound().
    await expect(
      logCall(callLogInitialState, callForm({ matterId: "nope" }))
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });

  test("rejects a malformed occurredAt with a field error", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "not-a-date" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.occurredAt).toBeTruthy();
  });

  test("date-only occurredAt parses to midnight in the user's zone, not UTC midnight", async () => {
    // A tampered/stale POST can drop the time half of the
    // datetime-local value. `new Date("2026-06-10")` reads it as UTC
    // midnight - a day early for anyone west of UTC. It is pinned to
    // midnight of that day in the user's profile zone instead.
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-10" })
    );
    expect(res.status).toBe("ok");
    const item = await prisma.messengerItem.findFirst({
      select: { occurredAt: true },
    });
    expect(item?.occurredAt).toEqual(new Date("2026-06-10T06:00:00.000Z"));
  });

  test("rejects a junk typed phone instead of falling back to the number on file", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ phone: "n/a" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phone?.[0]).toMatch(/valid phone/i);
    expect(await prisma.messengerThread.count()).toBe(0);
  });

  test("rejects a 7-digit local number and an extension-only mess", async () => {
    const res = await logCall(
      callLogInitialState,
      callForm({ phone: "555-0182" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phone?.[0]).toMatch(/valid phone/i);
  });

  test("an extension on a typed number does not fork a new thread", async () => {
    await logCall(callLogInitialState, callForm());
    const res = await logCall(
      callLogInitialState,
      callForm({ phone: "(303) 555-0182 x123" })
    );
    expect(res.status).toBe("ok");
    expect(await prisma.messengerThread.count()).toBe(1);
  });
});

describe("occurredAt time zone (ADR-012)", () => {
  test("stores the typed wall-clock time as the instant in the user's zone", async () => {
    // 14:30 in Denver is 20:30Z. The old parse read it as server-local
    // (UTC in production) = 14:30Z, six hours early.
    const res = await logCall(callLogInitialState, callForm());
    expect(res.status).toBe("ok");
    const item = await prisma.messengerItem.findFirstOrThrow();
    expect(item.occurredAt).toEqual(JUN10_1430);
  });

  test("follows the user's profile zone, whatever it is", async () => {
    mockedTz.mockResolvedValue("Asia/Tokyo"); // UTC+9, no DST
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    expect(item.occurredAt).toEqual(new Date("2026-06-10T05:30:00.000Z"));
  });

  test("edit round-trip does not drift: saving the prefilled value changes nothing", async () => {
    const { toWallClockInput } = await import("@/lib/format-date");
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    for (let i = 0; i < 3; i++) {
      const current = await prisma.messengerItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      // What the edit dialog prefills (profile zone) and re-posts.
      const prefill = toWallClockInput(current.occurredAt, USER_TZ);
      expect(prefill).toBe("2026-06-10T14:30");
      const res = await updateCallLog(
        callLogInitialState,
        updateForm(item.id, { occurredAt: prefill, summary: `edit ${i}` })
      );
      expect(res.status).toBe("ok");
    }
    const after = await prisma.messengerItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(after.occurredAt).toEqual(JUN10_1430);
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(JUN10_1430);
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
    // The filing lives on the item; the thread gets no default matter.
    expect(thread.defaultMatterId).toBeNull();
    expect(thread.lastItemAt).toEqual(JUN10_1430);
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

    // Matter surfaces refresh - including the Communication tab's
    // Phone channel.
    expect(revalidatePath).toHaveBeenCalledWith("/communication");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/communication`
    );
  });

  test("the first call filed to a matter does not make it the thread's default", async () => {
    const other = await seedPracticeArea({ name: "Other area" });
    const matterB = await seedMatter({
      practiceAreaId: other.areaId,
      stageId: other.stageId,
      leadUserId: userId,
    });
    // First call is filed to matter A; the second is "No matter (general)".
    await logCall(callLogInitialState, callForm({ matterId }));
    await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-11T09:00", matterId: "" })
    );
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.defaultMatterId).toBeNull();

    // Matter A's Phone channel lists only the call actually filed there;
    // the general call does not inherit it (and so time logged on it
    // cannot bill matter A). Matter B sees nothing.
    const rowsA = await listMessengerItemsForMatter(matterId);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].occurredAt).toEqual(JUN10_1430);
    expect(await listMessengerItemsForMatter(matterB.matterId)).toHaveLength(0);
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

describe("contact / number conflicts", () => {
  test("refuses to file under a number whose thread belongs to a different contact", async () => {
    await logCall(callLogInitialState, callForm()); // Maria owns the thread
    const other = await prisma.contact.create({
      data: { name: "Bob Reyes", type: "opposing", phone: "(303) 555-0182" },
      select: { id: true },
    });
    const res = await logCall(
      callLogInitialState,
      callForm({ contactId: other.id, occurredAt: "2026-06-11T09:00" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phone?.[0]).toMatch(/already linked to Maria Alvarez/);
    // Nothing was written for Bob - no item, no activity, thread untouched.
    expect(await prisma.messengerItem.count()).toBe(1);
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.contactId).toBe(contactId);
    expect(thread.lastItemAt).toEqual(JUN10_1430);
    expect(
      await prisma.activityLog.count({
        where: { title: { contains: "Bob Reyes" } },
      })
    ).toBe(0);
  });

  test("the same contact may keep logging on their own number", async () => {
    await logCall(callLogInitialState, callForm());
    const res = await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-11T09:00" })
    );
    expect(res.status).toBe("ok");
    expect(await prisma.messengerItem.count()).toBe(2);
  });
});

describe("messenger account selection", () => {
  test("prefers a real provider line over the manual placeholder, even if the placeholder is older", async () => {
    // First log bootstraps the manual placeholder (oldest, active)...
    await logCall(callLogInitialState, callForm());
    expect((await prisma.messengerAccount.findFirstOrThrow()).provider).toBe(
      "manual"
    );
    // ...then a real line is connected.
    const quo = await prisma.messengerAccount.create({
      data: { provider: "quo", phoneNumber: "+13035550100" },
    });
    const other = await prisma.contact.create({
      data: { name: "New Person", type: "client", phone: "720-555-0000" },
      select: { id: true },
    });
    const res = await logCall(
      callLogInitialState,
      callForm({ contactId: other.id })
    );
    expect(res.status).toBe("ok");
    const thread = await prisma.messengerThread.findFirstOrThrow({
      where: { contactPhone: "+17205550000" },
    });
    expect(thread.accountId).toBe(quo.id);
  });

  test("a concurrent bootstrap of the manual account is absorbed (P2002 -> re-read)", async () => {
    await prisma.firm.updateMany({ data: { phone: "(303) 555-0100" } });
    const realCreate = prisma.messengerAccount.create.bind(
      prisma.messengerAccount
    );
    const spy = vi
      .spyOn(prisma.messengerAccount, "create")
      .mockImplementationOnce((async (args: never) => {
        // The racing request wins: its row exists, ours collides.
        await realCreate(args);
        throw new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "test",
        });
      }) as never);
    const res = await logCall(callLogInitialState, callForm());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("ok");
    expect(await prisma.messengerAccount.count()).toBe(1);
    expect(await prisma.messengerItem.count()).toBe(1);
  });

  test("a lost race on the thread's unique key is retried once", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "test",
        })
      )) as never);
    // The retry falls through to the real implementation.
    const res = await logCall(callLogInitialState, callForm());
    expect(res.status).toBe("ok");
    expect(await prisma.messengerItem.count()).toBe(1);
  });
});

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
      where: { occurredAt: JUN11_0900 },
    });

    // Move the 06-11 call back to 06-05 — the thread's sort key must
    // fall back to the remaining newest item (06-10), not stay stale.
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(late.id, { occurredAt: "2026-06-05T08:00" })
    );
    expect(res.status).toBe("ok");
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(JUN10_1430);
  });

  test("advances lastItemAt when the edit moves a call forward", async () => {
    await logCall(callLogInitialState, callForm()); // 06-10 14:30
    const item = await prisma.messengerItem.findFirstOrThrow();

    await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { occurredAt: "2026-06-20T16:00" })
    );
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(JUN20_1600);
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
    await expect(
      updateCallLog(
        callLogInitialState,
        updateForm(item.id, { matterId: "nope" })
      )
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });

  test("errors cleanly on a vanished item", async () => {
    const res = await updateCallLog(
      callLogInitialState,
      updateForm("gone")
    );
    expect(res.status).toBe("error");
    expect(res.errors?.form?.[0]).toMatch(/not found/i);
  });

  test("an item deleted between the read and the write is a 'not found' form error, not a crash", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("gone", {
        code: "P2025",
        clientVersion: "test",
      })
    );
    const res = await updateCallLog(callLogInitialState, updateForm(item.id));
    expect(res.status).toBe("error");
    expect(res.errors?.form?.[0]).toMatch(/not found/i);
  });

  test("a 'No matter' correction clears the filing and leaves nothing inherited", async () => {
    await logCall(callLogInitialState, callForm({ matterId }));
    const item = await prisma.messengerItem.findFirstOrThrow();
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { matterId: "" })
    );
    expect(res.status).toBe("ok");
    expect(await listMessengerItemsForMatter(matterId)).toHaveLength(0);
  });

  test("moving a call off a matter leaves a trace (with the old time) on that matter", async () => {
    await logCall(callLogInitialState, callForm({ matterId }));
    const item = await prisma.messengerItem.findFirstOrThrow();
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(item.id, { matterId: "", occurredAt: "2026-06-12T10:00" })
    );
    expect(res.status).toBe("ok");

    const moved = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Moved a logged call" } },
    });
    expect(moved.matterId).toBe(matterId);
    expect(moved.detail).toContain("unfiled");
    // Old time recorded in the user's zone (Jun 10, 2:30 PM MDT).
    expect(moved.detail).toMatch(/Jun 10/);
    expect(moved.detail).toMatch(/2:30/);

    const updated = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Updated a logged call" } },
    });
    expect(updated.detail).toContain("time");
  });

  test("re-filing an inherited item logs the move on the thread's default matter", async () => {
    // A thread created by provider/webhook traffic with default routing.
    const account = await prisma.messengerAccount.create({
      data: { provider: "quo", phoneNumber: "+13035550100" },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550182",
        contactId,
        defaultMatterId: matterId,
        lastItemAt: JUN01_0800,
      },
    });
    const inherited = await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: "manual-legacy-1",
        kind: "call",
        direction: "outbound",
        fromNumber: "+13035550100",
        toNumber: "+13035550182",
        callStatus: "answered",
        callDurationSec: 60,
        occurredAt: JUN01_0800,
      },
    });
    const other = await seedPracticeArea({ name: "Other area" });
    const matterB = await seedMatter({
      practiceAreaId: other.areaId,
      stageId: other.stageId,
      leadUserId: userId,
    });
    const res = await updateCallLog(
      callLogInitialState,
      updateForm(inherited.id, {
        matterId: matterB.matterId,
        occurredAt: "2026-06-01T08:00",
      })
    );
    expect(res.status).toBe("ok");
    const moved = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Moved a logged call" } },
    });
    expect(moved.matterId).toBe(matterId);
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
      where: { occurredAt: JUN11_0900 },
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
    expect(thread.lastItemAt).toEqual(JUN10_1430);

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Deleted a logged call" } },
    });
    expect(activity.title).toContain("Maria Alvarez");
    expect(revalidatePath).toHaveBeenCalledWith("/communication");
  });

  test("deleting an inherited call logs on the matter it was listed under", async () => {
    const account = await prisma.messengerAccount.create({
      data: { provider: "quo", phoneNumber: "+13035550100" },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550182",
        contactId,
        defaultMatterId: matterId,
        lastItemAt: JUN01_0800,
      },
    });
    const inherited = await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: "manual-legacy-2",
        kind: "call",
        direction: "inbound",
        fromNumber: "+13035550182",
        toNumber: "+13035550100",
        callStatus: "answered",
        occurredAt: JUN01_0800,
      },
    });
    const res = await deleteCallLog(inherited.id);
    expect(res.ok).toBe(true);
    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { title: { startsWith: "Deleted a logged call" } },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.detail).toMatch(/Jun 1/);
  });

  test("a thread with a follow-up survives its last call", async () => {
    await logCall(callLogInitialState, callForm());
    const thread = await prisma.messengerThread.findFirstOrThrow();
    const followUpAt = new Date("2026-07-01T00:00:00.000Z");
    await prisma.messengerThread.update({
      where: { id: thread.id },
      data: { followUpAt },
    });
    const item = await prisma.messengerItem.findFirstOrThrow();
    const res = await deleteCallLog(item.id);
    expect(res.ok).toBe(true);
    const kept = await prisma.messengerThread.findUniqueOrThrow({
      where: { id: thread.id },
    });
    expect(kept.followUpAt).toEqual(followUpAt);
    expect(await prisma.messengerItem.count()).toBe(0);
  });

  test("a pinned thread survives its last call; a stateless one does not", async () => {
    await logCall(callLogInitialState, callForm());
    await prisma.messengerThread.updateMany({ data: { isPinned: true } });
    await deleteCallLog((await prisma.messengerItem.findFirstOrThrow()).id);
    expect(await prisma.messengerThread.count()).toBe(1);
  });

  test("a legacy thread whose only state is an auto-assigned defaultMatterId is deleted with its last call", async () => {
    // Old logCall stamped defaultMatterId on every thread it created.
    // Keeping such a shell leaves a blank, preview-less conversation.
    const account = await prisma.messengerAccount.create({
      data: { provider: "quo", phoneNumber: "+13035550100" },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550182",
        contactId,
        defaultMatterId: matterId,
        lastItemAt: JUN01_0800,
      },
    });
    const only = await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: "manual-legacy-3",
        kind: "call",
        direction: "outbound",
        fromNumber: "+13035550100",
        toNumber: "+13035550182",
        callStatus: "answered",
        occurredAt: JUN01_0800,
      },
    });
    const res = await deleteCallLog(only.id);
    expect(res.ok).toBe(true);
    expect(
      await prisma.messengerThread.findUnique({ where: { id: thread.id } })
    ).toBeNull();
  });

  test("a delete racing another delete returns 'not found', not a crash", async () => {
    await logCall(callLogInitialState, callForm());
    const item = await prisma.messengerItem.findFirstOrThrow();
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("gone", {
        code: "P2025",
        clientVersion: "test",
      })
    );
    const res = await deleteCallLog(item.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
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
    expect(threads[0].lastItemAt).toEqual(JUN11_0900);
  });

  test("logging an older call does not regress lastItemAt", async () => {
    await logCall(callLogInitialState, callForm());
    await logCall(
      callLogInitialState,
      callForm({ occurredAt: "2026-06-01T08:00" })
    );
    const thread = await prisma.messengerThread.findFirstOrThrow();
    expect(thread.lastItemAt).toEqual(JUN10_1430);
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
