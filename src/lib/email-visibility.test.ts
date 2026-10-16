/**
 * Integration tests for the email-thread read model helper.
 * Pins the scope itself (own mailbox only, filing to a matter does
 * not widen it) so a future change has to be deliberate.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  visibleEmailMessageWhere,
  visibleEmailThreadWhere,
} from "@/lib/email-visibility";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let aId: string;
let bId: string;
let aThreadId: string;
let aMessageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: aId } = await seedUser({ firmId }));
  ({ userId: bId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  // B leads the matter A's thread is filed to - team membership on
  // the matter must NOT make A's mailbox visible to B.
  const { matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: bId,
  });
  const account = await prisma.emailAccount.create({
    data: { userId: aId, emailAddress: "a@firm.test" },
    select: { id: true },
  });
  const thread = await prisma.emailThread.create({
    data: {
      accountId: account.id,
      matterId,
      subject: "A's filed thread",
      lastMessageAt: new Date("2026-07-01T12:00:00Z"),
      messages: {
        create: {
          fromName: "X",
          fromEmail: "x@example.test",
          toRecipients: "[]",
          body: "hello",
          sentAt: new Date("2026-07-01T12:00:00Z"),
        },
      },
    },
    select: { id: true, messages: { select: { id: true } } },
  });
  aThreadId = thread.id;
  aMessageId = thread.messages[0].id;
});

describe("visibleEmailThreadWhere", () => {
  test("matches the owner's threads, not a colleague's - even on a shared matter", async () => {
    const mine = await prisma.emailThread.findMany({
      where: visibleEmailThreadWhere(aId),
      select: { id: true },
    });
    expect(mine.map((t) => t.id)).toEqual([aThreadId]);

    const theirs = await prisma.emailThread.findMany({
      where: visibleEmailThreadWhere(bId),
      select: { id: true },
    });
    expect(theirs).toEqual([]);
  });
});

describe("visibleEmailMessageWhere", () => {
  test("matches the owner's messages only", async () => {
    expect(
      await prisma.emailMessage.count({
        where: { id: aMessageId, ...visibleEmailMessageWhere(aId) },
      })
    ).toBe(1);
    expect(
      await prisma.emailMessage.count({
        where: { id: aMessageId, ...visibleEmailMessageWhere(bId) },
      })
    ).toBe(0);
  });
});
