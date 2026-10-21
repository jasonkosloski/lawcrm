/** Integration: open matters lacking a signed agreement WITH a document. */
import { beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { countMattersMissingSignedAgreement } from "@/lib/queries/agreement-missing";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let base: { practiceAreaId: string; stageId: string; leadUserId: string };

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  base = { practiceAreaId: areaId, stageId, leadUserId: userId };
});

describe("countMattersMissingSignedAgreement", () => {
  test("counts none / unsigned / signed-without-document; skips complete and archived", async () => {
    const none = await seedMatter({ ...base, name: "no record" });
    const unsigned = await seedMatter({ ...base, name: "sent" });
    const signedNoDoc = await seedMatter({ ...base, name: "signed no doc" });
    const complete = await seedMatter({ ...base, name: "complete" });
    const archived = await seedMatter({ ...base, name: "archived" });
    expect(none.matterId).toBeTruthy();

    await prisma.matterAgreement.create({
      data: { matterId: unsigned.matterId, status: "sent" },
    });
    await prisma.matterAgreement.create({
      data: {
        matterId: signedNoDoc.matterId,
        status: "signed",
        signedDate: new Date("2020-01-02T00:00:00Z"),
      },
    });
    const { documentId } = await seedDocument({ matterId: complete.matterId });
    await prisma.matterAgreement.create({
      data: {
        matterId: complete.matterId,
        status: "signed",
        signedDate: new Date("2020-01-02T00:00:00Z"),
        documentId,
      },
    });
    await prisma.matter.update({
      where: { id: archived.matterId },
      data: { isArchived: true },
    });

    expect(await countMattersMissingSignedAgreement()).toBe(3);
  });
});
