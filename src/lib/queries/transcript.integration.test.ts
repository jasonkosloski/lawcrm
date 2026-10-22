/**
 * getDocumentTranscript against the real test DB: null when none, shaped
 * rows in segment order, and the matter wall refuses an outsider.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { prisma } from "@/lib/prisma";
import { getDocumentTranscript } from "@/lib/queries/transcript";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let firmId: string;
let alice: string;
let bob: string;
let docId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  let defaultRoleId: string;
  ({ firmId, defaultRoleId } = await seedFirm());
  ({ userId: alice } = await seedUser({ firmId, name: "Alice", initials: "AL", roleIds: [defaultRoleId] }));
  ({ userId: bob } = await seedUser({ firmId, name: "Bob", initials: "BO", roleIds: [defaultRoleId] }));
  const { areaId, stageId } = await seedPracticeArea();
  const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: alice });
  ({ documentId: docId } = await seedDocument({ matterId, contentType: "video/mp4" }));
  await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
  sessionUser = alice;
});

describe("getDocumentTranscript", () => {
  test("returns null when the document has no transcript", async () => {
    expect(await getDocumentTranscript(docId)).toBeNull();
  });

  test("returns the transcript with ordered segments and corrector name", async () => {
    const t = await prisma.transcript.create({
      data: {
        documentId: docId,
        status: "completed",
        requestedById: alice,
        correctedById: alice,
        correctedAt: new Date(),
        speakers: { A: "Officer Diaz" },
      },
    });
    for (const index of [1, 0]) {
      await prisma.transcriptSegment.create({
        data: {
          transcriptId: t.id,
          index,
          speaker: "A",
          startSeconds: index * 10,
          endSeconds: index * 10 + 5,
          text: `seg ${index}`,
          words: [{ w: "seg", s: index * 10, e: index * 10 + 1 }],
        },
      });
    }
    const view = await getDocumentTranscript(docId);
    expect(view?.status).toBe("completed");
    expect(view?.correctedByName).toBe("Alice");
    expect(view?.speakers).toEqual({ A: "Officer Diaz" });
    expect(view?.segments.map((s) => s.index)).toEqual([0, 1]);
    expect(view?.segments[1].words[0].w).toBe("seg");
  });

  test("a user walled off from the matter is refused", async () => {
    await prisma.transcript.create({
      data: { documentId: docId, status: "processing", requestedById: alice },
    });
    sessionUser = bob;
    await expect(getDocumentTranscript(docId)).rejects.toThrow();
  });
});
