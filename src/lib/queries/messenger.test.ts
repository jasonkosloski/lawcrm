/**
 * Integration tests for messenger queries.
 *
 * `listMessengerItemsForMatter` drives the Phone channel of the
 * matter-detail Communication tab — these pin down the filing
 * resolution rule (direct item.matterId OR inherited from
 * thread.defaultMatterId), cross-matter isolation, and ordering.
 *
 * `listMessengerThreads` feeds the inbox thread list — pinned here:
 * `lastCallStatus` carries the raw status of the most recent item so
 * the UI detects missed calls (incl. no_answer, and calls whose
 * summary occupies body) without parsing the preview string.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getMessengerMailboxCounts,
  getMessengerThread,
  getMessengerUnreadCount,
  isMissedCall,
  listMessengerItemsForMatter,
  listMessengerThreads,
  listMessengerThreadsForLead,
  listMessengerThreadsForPhone,
  normalizePhone,
} from "@/lib/queries/messenger";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let otherMatterId: string;
let accountId: string;

async function seedItem(opts: {
  threadId: string;
  matterId?: string | null;
  kind?: string;
  direction?: string;
  callStatus?: string | null;
  body?: string | null;
  occurredAt: string;
}): Promise<string> {
  const item = await prisma.messengerItem.create({
    data: {
      threadId: opts.threadId,
      providerEventId: `test-${Math.random().toString(36).slice(2)}`,
      kind: opts.kind ?? "call",
      direction: opts.direction ?? "outbound",
      callStatus: opts.callStatus ?? null,
      fromNumber: "+13035550100",
      toNumber: "+13035550182",
      body: opts.body ?? null,
      matterId: opts.matterId ?? null,
      occurredAt: new Date(opts.occurredAt),
    },
    select: { id: true },
  });
  return item.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
  ({ matterId: otherMatterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Other Matter",
  }));
  const account = await prisma.messengerAccount.create({
    data: { provider: "manual", phoneNumber: "+13035550100" },
    select: { id: true },
  });
  accountId = account.id;
});

describe("listMessengerItemsForMatter", () => {
  test("includes directly-filed items and thread-default items, newest first", async () => {
    const contact = await prisma.contact.create({
      data: { name: "Maria Alvarez", type: "client" },
      select: { id: true },
    });
    // Thread default-routed to the matter — null-matter items inherit.
    const routedThread = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+13035550182",
        contactId: contact.id,
        defaultMatterId: matterId,
        lastItemAt: new Date("2026-06-10T12:00"),
      },
      select: { id: true },
    });
    // Unrouted thread — only explicitly-filed items count.
    const unroutedThread = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+17205550000",
        lastItemAt: new Date("2026-06-10T12:00"),
      },
      select: { id: true },
    });

    await seedItem({
      threadId: routedThread.id,
      occurredAt: "2026-06-09T10:00",
      body: "inherited via thread default",
    });
    await seedItem({
      threadId: unroutedThread.id,
      matterId,
      occurredAt: "2026-06-10T10:00",
      body: "explicitly filed",
    });
    // Noise that must not appear:
    await seedItem({
      threadId: unroutedThread.id,
      occurredAt: "2026-06-10T11:00",
      body: "unfiled",
    });
    await seedItem({
      threadId: routedThread.id,
      matterId: otherMatterId,
      occurredAt: "2026-06-10T12:00",
      body: "overridden to another matter",
    });

    const items = await listMessengerItemsForMatter(matterId);
    expect(items.map((i) => i.body)).toEqual([
      "explicitly filed",
      "inherited via thread default",
    ]);
    // Contact resolution comes from the thread.
    expect(items[1].contactName).toBe("Maria Alvarez");
    expect(items[0].contactName).toBeNull();
    expect(items[0].contactPhone).toBe("+17205550000");
  });

  test("voicemail transcript falls back into body", async () => {
    const thread = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+13035550182",
        defaultMatterId: matterId,
        lastItemAt: new Date("2026-06-10T12:00"),
      },
      select: { id: true },
    });
    await prisma.messengerItem.create({
      data: {
        threadId: thread.id,
        providerEventId: "test-vm-1",
        kind: "voicemail",
        direction: "inbound",
        fromNumber: "+13035550182",
        toNumber: "+13035550100",
        transcript: "Please call me back about the deposition.",
        occurredAt: new Date("2026-06-10T09:00"),
      },
    });
    const items = await listMessengerItemsForMatter(matterId);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("voicemail");
    expect(items[0].body).toBe("Please call me back about the deposition.");
  });

  test("returns empty for a matter with no filed items", async () => {
    expect(await listMessengerItemsForMatter(matterId)).toEqual([]);
  });
});

describe("listMessengerThreads — lastCallStatus + call preview", () => {
  async function seedThread(phone: string): Promise<string> {
    const t = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: phone,
        lastItemAt: new Date("2026-06-10T12:00"),
      },
      select: { id: true },
    });
    return t.id;
  }

  test("exposes the raw call status of the most recent item", async () => {
    const threadId = await seedThread("+13035550182");
    // Older answered call must not leak into the preview fields.
    await seedItem({
      threadId,
      direction: "inbound",
      callStatus: "answered",
      occurredAt: "2026-06-09T10:00",
    });
    await seedItem({
      threadId,
      direction: "inbound",
      callStatus: "no_answer",
      occurredAt: "2026-06-10T10:00",
    });

    const [row] = await listMessengerThreads();
    expect(row.lastKind).toBe("call");
    expect(row.lastCallStatus).toBe("no_answer");
    // no_answer inbound with no body derives the missed preview too.
    expect(row.lastBody).toBe("Missed call");
  });

  test("answered call with a summary body keeps body and status distinct", async () => {
    const threadId = await seedThread("+13035550182");
    await seedItem({
      threadId,
      direction: "inbound",
      callStatus: "answered",
      body: "Discussed settlement terms",
      occurredAt: "2026-06-10T10:00",
    });

    const [row] = await listMessengerThreads();
    expect(row.lastCallStatus).toBe("answered");
    expect(row.lastBody).toBe("Discussed settlement terms");
  });

  test("sms threads carry a null lastCallStatus", async () => {
    const threadId = await seedThread("+13035550182");
    await seedItem({
      threadId,
      kind: "sms",
      direction: "inbound",
      body: "Hello",
      occurredAt: "2026-06-10T10:00",
    });

    const [row] = await listMessengerThreads();
    expect(row.lastKind).toBe("sms");
    expect(row.lastCallStatus).toBeNull();
  });
});

describe("isMissedCall", () => {
  test.each([
    ["missed", true],
    ["no_answer", true],
    ["declined", true],
    // busy/failed excluded on purpose — see MISSED_CALL_STATUSES.
    ["busy", false],
    ["failed", false],
    ["answered", false],
  ] as const)("inbound %s → %s", (status, expected) => {
    expect(isMissedCall("inbound", status)).toBe(expected);
  });

  test("outbound calls are never missed, regardless of status", () => {
    expect(isMissedCall("outbound", "missed")).toBe(false);
    expect(isMissedCall("outbound", "no_answer")).toBe(false);
  });

  test("null direction or status is not missed", () => {
    expect(isMissedCall(null, "missed")).toBe(false);
    expect(isMissedCall("inbound", null)).toBe(false);
  });
});

describe("normalizePhone", () => {
  test.each([
    ["(303) 555-0182", "+13035550182"],
    ["303.555.0182", "+13035550182"],
    ["1-303-555-0182", "+13035550182"],
    ["+1 (303) 555-0182", "+13035550182"],
    ["+13035550182", "+13035550182"],
    // Extensions don't fork a new number.
    ["(303) 555-0182 x123", "+13035550182"],
    ["303-555-0182 ext. 4", "+13035550182"],
    // International needs an explicit +.
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["n/a"],
    ["555-0182"], // 7-digit local number
    ["30355501822"], // 11 digits not starting with 1, no +
    ["+123"], // too short even with +
  ])("%s -> null", (raw) => {
    expect(normalizePhone(raw as string | null | undefined)).toBeNull();
  });
});

describe("listMessengerThreads filters + mailbox counts", () => {
  async function seedThread(opts: {
    phone: string;
    contactId?: string | null;
    unread?: number;
    pinned?: boolean;
    archived?: boolean;
    defaultMatterId?: string | null;
  }): Promise<string> {
    const t = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: opts.phone,
        contactId: opts.contactId ?? null,
        unreadCount: opts.unread ?? 0,
        isPinned: opts.pinned ?? false,
        isArchived: opts.archived ?? false,
        defaultMatterId: opts.defaultMatterId ?? null,
        lastItemAt: new Date("2026-06-10T12:00:00Z"),
      },
      select: { id: true },
    });
    return t.id;
  }

  test("unread / pinned / unfiled filters and counts agree, archived excluded", async () => {
    await seedThread({ phone: "+13035550001" }); // plain, unfiled
    await seedThread({ phone: "+13035550002", unread: 2 });
    await seedThread({ phone: "+13035550003", pinned: true });
    await seedThread({ phone: "+13035550004", archived: true, unread: 1 });
    await seedThread({ phone: "+13035550005", defaultMatterId: matterId });
    const itemFiled = await seedThread({ phone: "+13035550006" });
    await seedItem({
      threadId: itemFiled,
      matterId,
      occurredAt: "2026-06-10T10:00",
    });

    const counts = await getMessengerMailboxCounts();
    for (const f of ["all", "unread", "unfiled", "pinned"] as const) {
      const rows = await listMessengerThreads({ filter: f });
      expect(counts[f]).toBe(rows.length);
    }
    expect(counts).toEqual({ all: 5, unread: 1, unfiled: 3, pinned: 1 });
    expect(await getMessengerUnreadCount()).toBe(1);
  });

  test("'unfiled' means no default matter AND no item-level matter", async () => {
    const perItem = await seedThread({ phone: "+13035550010" });
    await seedItem({
      threadId: perItem,
      matterId,
      occurredAt: "2026-06-10T10:00",
    });
    const bare = await seedThread({ phone: "+13035550011" });
    await seedItem({ threadId: bare, occurredAt: "2026-06-10T10:00" });
    const emptyThread = await seedThread({ phone: "+13035550012" });

    const ids = (await listMessengerThreads({ filter: "unfiled" })).map(
      (r) => r.id
    );
    expect(ids.sort()).toEqual([bare, emptyThread].sort());
  });
});

describe("lead Communication tab thread lookup", () => {
  test("matches by contact id even when the call was logged on a different number", async () => {
    const contact = await prisma.contact.create({
      data: { name: "Lead Person", type: "client", phone: "(303) 555-0100" },
      select: { id: true },
    });
    const onFile = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+13035550100",
        lastItemAt: new Date("2026-06-10T10:00:00Z"),
      },
      select: { id: true },
    });
    // Logged from the lead tab with a typed cell number: keyed by that
    // number, linked to the contact.
    const typed = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+17205559999",
        contactId: contact.id,
        lastItemAt: new Date("2026-06-11T10:00:00Z"),
      },
      select: { id: true },
    });
    await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+17205551111",
        lastItemAt: new Date("2026-06-12T10:00:00Z"),
      },
    });

    const rows = await listMessengerThreadsForLead({
      contactId: contact.id,
      phones: ["(303) 555-0100", null, "junk"],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([onFile.id, typed.id].sort());
    // Nothing to match on -> nothing.
    expect(
      await listMessengerThreadsForLead({ contactId: null, phones: ["junk"] })
    ).toEqual([]);
  });

  test("listMessengerThreadsForPhone normalizes then exact-matches", async () => {
    await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+13035550182",
        lastItemAt: new Date("2026-06-10T10:00:00Z"),
      },
    });
    expect(await listMessengerThreadsForPhone("(303) 555-0182")).toHaveLength(1);
    expect(await listMessengerThreadsForPhone("not a phone")).toEqual([]);
  });
});

describe("getMessengerThread", () => {
  test("returns null for an unknown id", async () => {
    expect(await getMessengerThread("nope")).toBeNull();
  });

  test("flags manual items and tolerates malformed mediaUrls", async () => {
    const thread = await prisma.messengerThread.create({
      data: {
        accountId,
        contactPhone: "+13035550182",
        lastItemAt: new Date("2026-06-10T12:00:00Z"),
      },
      select: { id: true },
    });
    const base = {
      threadId: thread.id,
      kind: "sms",
      direction: "inbound",
      fromNumber: "+13035550182",
      toNumber: "+13035550100",
    };
    await prisma.messengerItem.create({
      data: {
        ...base,
        providerEventId: "manual-abc",
        occurredAt: new Date("2026-06-10T10:00:00Z"),
        mediaUrls: [
          { url: "https://x/y.png", contentType: "image/png" },
          7,
          null,
          { nope: 1 },
        ],
      },
    });
    await prisma.messengerItem.create({
      data: {
        ...base,
        providerEventId: "quo-1",
        occurredAt: new Date("2026-06-10T11:00:00Z"),
        mediaUrls: { not: "an array" },
      },
    });
    const detail = await getMessengerThread(thread.id);
    expect(detail?.items.map((i) => i.isManual)).toEqual([true, false]);
    expect(detail?.items[0].mediaUrls).toEqual([
      { url: "https://x/y.png", contentType: "image/png", sizeBytes: undefined },
    ]);
    expect(detail?.items[1].mediaUrls).toEqual([]);
  });
});
