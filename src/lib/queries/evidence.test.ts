/**
 * Integration tests for the evidence-review loaders.
 *
 * Contract under test:
 *   - matter scoping: another matter's flags never leak in;
 *   - grouping: one group per flagged document, in the Documents
 *     tab's name-asc walk order, anchor-ordered inside (time asc /
 *     page asc, anchorless last, createdAt tiebreak);
 *   - EVERY anchor kind surfaces — time, page, quote, anchorless;
 *   - renderer resolves through resolveDocumentRenderer (including
 *     the extension fallback for typeless uploads);
 *   - flagger display fields ride along for the initials chip;
 *   - the per-document loader is anchor-ordered.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  getDocumentFlaggedMoments,
  getMatterFlaggedMoments,
} from "@/lib/queries/evidence";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedFlaggedMoment,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let otherMatterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, name: "Ana Reviewer", initials: "AR" });
  userId = u.userId;
  const area = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    })
  ).matterId;
  otherMatterId = (
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Other Matter",
    })
  ).matterId;
});

describe("getMatterFlaggedMoments", () => {
  test("groups by document in name order, moments time-ascending", async () => {
    const zeta = await seedDocument({
      matterId,
      name: "Zeta dashcam.mp4",
      contentType: "video/mp4",
    });
    const alpha = await seedDocument({
      matterId,
      name: "Alpha 911 call.mp3", // typeless → extension fallback
      contentType: null,
    });
    // Seed out of order to prove ordering comes from the query.
    await seedFlaggedMoment({
      documentId: zeta.documentId,
      flaggedById: userId,
      timeSeconds: 300,
      category: "critical",
    });
    await seedFlaggedMoment({
      documentId: alpha.documentId,
      flaggedById: userId,
      timeSeconds: 90,
      endSeconds: 120,
      category: "miranda",
    });
    await seedFlaggedMoment({
      documentId: zeta.documentId,
      flaggedById: userId,
      timeSeconds: 12,
      category: "anomaly",
    });

    const groups = await getMatterFlaggedMoments(matterId);
    expect(groups.map((g) => g.documentName)).toEqual([
      "Alpha 911 call.mp3",
      "Zeta dashcam.mp4",
    ]);
    expect(groups[0].renderer).toBe("audio");
    expect(groups[1].renderer).toBe("video");
    expect(groups[1].moments.map((m) => m.timeSeconds)).toEqual([12, 300]);
    // Span + flagger display fields ride along.
    expect(groups[0].moments[0]).toMatchObject({
      endSeconds: 120,
      category: "miranda",
      flaggedByName: "Ana Reviewer",
      flaggedByInitials: "AR",
    });
  });

  test("excludes other matters' flags and unflagged documents", async () => {
    const mine = await seedDocument({
      matterId,
      name: "Mine.mp4",
      contentType: "video/mp4",
    });
    await seedDocument({
      matterId,
      name: "Unflagged.mp4",
      contentType: "video/mp4",
    });
    const foreign = await seedDocument({
      matterId: otherMatterId,
      name: "Foreign.mp4",
      contentType: "video/mp4",
    });
    await seedFlaggedMoment({ documentId: mine.documentId, flaggedById: userId });
    await seedFlaggedMoment({
      documentId: foreign.documentId,
      flaggedById: userId,
    });

    const groups = await getMatterFlaggedMoments(matterId);
    expect(groups).toHaveLength(1);
    expect(groups[0].documentName).toBe("Mine.mp4");
    expect(groups[0].moments).toHaveLength(1);
  });

  test("empty matter returns an empty list", async () => {
    expect(await getMatterFlaggedMoments(matterId)).toEqual([]);
  });

  test("page, quote, and anchorless flags all surface with their anchors", async () => {
    const pdf = await seedDocument({
      matterId,
      name: "Complaint.pdf",
      contentType: "application/pdf",
    });
    const docx = await seedDocument({
      matterId,
      name: "Transcript.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    // Seed page flags out of order + an anchorless one, prove
    // ordering: pages asc, anchorless last.
    await seedFlaggedMoment({
      documentId: pdf.documentId,
      flaggedById: userId,
      timeSeconds: null, // anchorless
      description: "Whole filing is suspect",
    });
    await seedFlaggedMoment({
      documentId: pdf.documentId,
      flaggedById: userId,
      pageNumber: 12,
    });
    await seedFlaggedMoment({
      documentId: pdf.documentId,
      flaggedById: userId,
      pageNumber: 3,
    });
    await seedFlaggedMoment({
      documentId: docx.documentId,
      flaggedById: userId,
      quote: "I never saw the light change",
    });

    const groups = await getMatterFlaggedMoments(matterId);
    expect(groups.map((g) => g.renderer)).toEqual(["pdf", "docx"]);

    const pdfGroup = groups[0];
    expect(
      pdfGroup.moments.map((m) => ({ page: m.pageNumber, time: m.timeSeconds }))
    ).toEqual([
      { page: 3, time: null },
      { page: 12, time: null },
      { page: null, time: null }, // anchorless sinks to the end
    ]);

    expect(groups[1].moments[0]).toMatchObject({
      quote: "I never saw the light change",
      timeSeconds: null,
      pageNumber: null,
    });
  });
});

describe("getDocumentFlaggedMoments", () => {
  test("time-ordered flags for one document only", async () => {
    const doc = await seedDocument({
      matterId,
      name: "Bodycam.mp4",
      contentType: "video/mp4",
    });
    const other = await seedDocument({
      matterId,
      name: "Other.mp4",
      contentType: "video/mp4",
    });
    await seedFlaggedMoment({
      documentId: doc.documentId,
      flaggedById: userId,
      timeSeconds: 45,
    });
    await seedFlaggedMoment({
      documentId: doc.documentId,
      flaggedById: userId,
      timeSeconds: 5,
    });
    await seedFlaggedMoment({
      documentId: other.documentId,
      flaggedById: userId,
      timeSeconds: 1,
    });

    const rows = await getDocumentFlaggedMoments(doc.documentId);
    expect(rows.map((r) => r.timeSeconds)).toEqual([5, 45]);
    expect(rows.every((r) => r.documentId === doc.documentId)).toBe(true);
  });
});
