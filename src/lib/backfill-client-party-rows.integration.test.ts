/**
 * Backfill for matters converted from leads before the client party
 * row was created: inserts the missing MatterContact(client) rows,
 * touches nothing else, and is idempotent.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { backfillClientPartyRows } from "@/lib/backfill-client-party-rows";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let base: { practiceAreaId: string; stageId: string; leadUserId: string };

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, email: "a@example.com" });
  const { areaId, stageId } = await seedPracticeArea();
  base = { practiceAreaId: areaId, stageId, leadUserId: userId };
});

describe("backfillClientPartyRows", () => {
  test("adds the missing client row once, skips complete matters, is idempotent", async () => {
    const client = await seedContact({ name: "Priya Patel" });
    const other = await seedContact({ name: "Other Client" });
    const broken = await seedMatter({ ...base, name: "Converted pre-fix" });
    const whole = await seedMatter({ ...base, name: "Already whole" });
    const noClient = await seedMatter({ ...base, name: "No client" });
    await prisma.matter.update({
      where: { id: broken.matterId },
      data: { clientId: client.contactId },
    });
    await prisma.matter.update({
      where: { id: whole.matterId },
      data: {
        clientId: other.contactId,
        contacts: {
          create: { contactId: other.contactId, category: "client" },
        },
      },
    });

    const dry = await backfillClientPartyRows(prisma, { dryRun: true });
    expect(dry).toEqual({ missing: 1, created: 0 });
    expect(await prisma.matterContact.count()).toBe(1);

    const run = await backfillClientPartyRows(prisma);
    expect(run).toEqual({ missing: 1, created: 1 });
    const rows = await prisma.matterContact.findMany({
      where: { matterId: broken.matterId },
      select: { contactId: true, category: true },
    });
    expect(rows).toEqual([{ contactId: client.contactId, category: "client" }]);
    expect(await prisma.matterContact.count({ where: { matterId: noClient.matterId } })).toBe(0);

    const again = await backfillClientPartyRows(prisma);
    expect(again).toEqual({ missing: 0, created: 0 });
    expect(await prisma.matterContact.count()).toBe(2);
  });
});
