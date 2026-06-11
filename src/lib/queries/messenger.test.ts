/**
 * Integration tests for matter-scoped messenger queries.
 *
 * `listMessengerItemsForMatter` drives the Phone channel of the
 * matter-detail Communication tab — these pin down the filing
 * resolution rule (direct item.matterId OR inherited from
 * thread.defaultMatterId), cross-matter isolation, and ordering.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
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
  body?: string | null;
  occurredAt: string;
}): Promise<string> {
  const item = await prisma.messengerItem.create({
    data: {
      threadId: opts.threadId,
      providerEventId: `test-${Math.random().toString(36).slice(2)}`,
      kind: opts.kind ?? "call",
      direction: "outbound",
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
