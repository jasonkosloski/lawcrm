/**
 * Money and legal records are never collateral damage of a matter or
 * lead delete (migration 20261018220000_restrict_record_deletes). The
 * app never deletes either; this pins the database-level guard so a
 * script or manual DELETE fails instead of erasing a trust ledger.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
});

describe("record retention on matter/lead delete", () => {
  test("a matter with a trust transaction cannot be deleted", async () => {
    await prisma.trustTransaction.create({
      data: {
        matterId,
        type: "deposit",
        amount: "500.00",
        description: "Retainer",
        date: new Date("2026-10-01T00:00:00Z"),
      },
    });
    await expect(prisma.matter.delete({ where: { id: matterId } })).rejects.toThrow();
    expect(await prisma.trustTransaction.count()).toBe(1);
  });

  test("a matter with billable time cannot be deleted", async () => {
    await seedTimeEntry({ matterId, userId });
    await expect(prisma.matter.delete({ where: { id: matterId } })).rejects.toThrow();
    expect(await prisma.timeEntry.count()).toBe(1);
  });

  test("a lead with time cannot be deleted", async () => {
    const { leadId } = await seedLead();
    await seedTimeEntry({ leadId, userId });
    await expect(prisma.lead.delete({ where: { id: leadId } })).rejects.toThrow();
  });

  test("an empty matter still deletes (team rows still cascade)", async () => {
    await prisma.matter.delete({ where: { id: matterId } });
    expect(await prisma.matterTeamMember.count()).toBe(0);
  });
});
