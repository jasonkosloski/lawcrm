/** Integration: is a stored-file key referenced by a Document row or a
 *  sent email's attachment row. */
import { beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { isStoredFileReferenced } from "@/lib/stored-file-refs";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

beforeEach(async () => {
  await resetDb();
});

describe("isStoredFileReferenced", () => {
  test("true only when a Document points at the key", async () => {
    const { firmId } = await seedFirm();
    const { userId } = await seedUser({ firmId });
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "M",
    });
    await prisma.document.create({
      data: { matterId, name: "a.pdf", fileUrl: "kept-key", uploadedBy: userId },
    });
    expect(await isStoredFileReferenced("kept-key")).toBe(true);
    expect(await isStoredFileReferenced("other-key")).toBe(false);
  });

  test("true when an app-sent email attachment points at the key", async () => {
    const { firmId } = await seedFirm();
    const { userId } = await seedUser({ firmId });
    const account = await prisma.emailAccount.create({
      data: { userId, emailAddress: "me@firm.com" },
    });
    const thread = await prisma.emailThread.create({
      data: { accountId: account.id, subject: "S", lastMessageAt: new Date() },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        externalId: "gm-1",
        fromName: "Me",
        fromEmail: "me@firm.com",
        toRecipients: "[]",
        body: "",
        sentAt: new Date(),
        attachments: { create: { filename: "a.pdf", fileUrl: "sent-key" } },
      },
    });
    expect(await isStoredFileReferenced("sent-key")).toBe(true);
  });
});
